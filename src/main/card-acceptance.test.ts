import { beforeEach, expect, it, vi } from 'vitest'
import type { KnowledgeCard } from '../shared/knowledge-card'
import type { RouterClassification } from '../shared/router'
import { generateKnowledgeCard, getResumableDraftClassification } from './knowledge-card-service'
import { generateProviderText } from './provider-adapters'
import { GrammarReviewError, reviewGrammar } from './grammar-review'

vi.mock('./provider-adapters', () => ({ generateProviderText: vi.fn() }))
vi.mock('./grammar-review', async importOriginal => ({
  ...await importOriginal<typeof import('./grammar-review')>(), reviewGrammar: vi.fn()
}))

const classification: RouterClassification = {
  inputType: 'word', structureType: 'single_word', targetText: 'rain', targets: ['rain'],
  focusText: '', intent: 'explain_meaning', modules: ['meaning', 'phonetic', 'examples'],
  confidence: 1, needsClarification: false, clarificationQuestion: '', responseMode: 'card'
}
const card: KnowledgeCard = {
  cardType: 'word', targetText: 'rain', targets: ['rain'], answer: '雨。', sections: [
    { module: 'meaning', content: '雨。' }, { module: 'phonetic', content: '- **UK/US:** /reɪn/' },
    { module: 'examples', content: '', examples: [
      { english: 'I like the rain.', translation: '我喜欢下雨。' },
      { english: 'The rain stopped.', translation: '雨停了。' }
    ] }
  ]
}
const options = { answerLanguage: 'zh' as const, apiKey: 'test-key', modelName: 'test-model', modelProvider: 'openai' as const,
  request: { sourceQuestion: 'rain', recentContext: [], classification } }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify(card))
  vi.mocked(reviewGrammar).mockImplementation(async draft => draft)
})

const invalidCards: [string, (draft: KnowledgeCard) => KnowledgeCard][] = [
  ['wrong type', draft => ({ ...draft, cardType: 'phrase' })],
  ['wrong targets', draft => ({ ...draft, targets: ['snow'] })],
  ['missing module', draft => ({ ...draft, sections: draft.sections.filter(section => section.module !== 'meaning') })],
  ['invalid IPA', draft => ({ ...draft, sections: draft.sections.map(section => section.module === 'phonetic' ? { ...section, content: 'Not IPA' } : section) })],
  ['wrong count', draft => ({ ...draft, sections: draft.sections.map(section => section.module === 'examples' ? { ...section, examples: section.examples!.slice(0, 1) } : section) })],
  ['missing translation', draft => ({ ...draft, sections: draft.sections.map(section => section.module === 'examples' ? { ...section, examples: section.examples!.map(example => ({ english: example.english })) } : section) })]
]

it.each(invalidCards)('rejects %s before review without retrying', async (_name, invalidate) => {
  vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify(invalidate(structuredClone(card))))
  await expect(generateKnowledgeCard(options)).rejects.toThrow()
  expect(generateProviderText).toHaveBeenCalledTimes(1)
  expect(reviewGrammar).not.toHaveBeenCalled()
})

it.each(invalidCards)('rechecks %s after review and never returns the invalid card', async (_name, invalidate) => {
  vi.mocked(reviewGrammar).mockImplementation(async draft => invalidate(draft))
  await expect(generateKnowledgeCard(options)).rejects.toThrow()
  expect(generateProviderText).toHaveBeenCalledTimes(1)
  expect(reviewGrammar).toHaveBeenCalledTimes(1)
})

it('rejects malformed JSON before review', async () => {
  vi.mocked(generateProviderText).mockResolvedValue('not JSON')
  await expect(generateKnowledgeCard(options)).rejects.toThrow('not valid JSON')
  expect(reviewGrammar).not.toHaveBeenCalled()
})

it('normalizes order in both acceptance passes without extra calls', async () => {
  vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify({ ...card, sections: [...card.sections].reverse() }))
  vi.mocked(reviewGrammar).mockImplementation(async draft => ({ ...draft, sections: [...draft.sections].reverse() }))
  await expect(generateKnowledgeCard(options)).resolves.toEqual(card)
  expect(generateProviderText).toHaveBeenCalledTimes(1)
  expect(reviewGrammar).toHaveBeenCalledTimes(1)
})

it.each(['before generation', 'after generation', 'after review'])(
  'preserves cancellation %s even when dependencies return a result', async stage => {
    const controller = new AbortController()
    const reason = new Error('User stopped this request.')
    if (stage === 'before generation') controller.abort(reason)
    if (stage === 'after generation') vi.mocked(generateProviderText).mockImplementation(async () => {
      controller.abort(reason)
      return JSON.stringify(card)
    })
    if (stage === 'after review') vi.mocked(reviewGrammar).mockImplementation(async draft => {
      controller.abort(reason)
      return draft
    })
    await expect(generateKnowledgeCard({ ...options, signal: controller.signal })).rejects.toBe(reason)
    expect(generateProviderText).toHaveBeenCalledTimes(stage === 'before generation' ? 0 : 1)
    expect(reviewGrammar).toHaveBeenCalledTimes(stage === 'after review' ? 1 : 0)
  }
)

it.each(['timeout', 'network_failed', 'rate_limited', 'provider_unavailable'] as const)(
  'reuses a validated draft only on explicit retry after %s', async code => {
    const id = `resume-${code}`
    vi.mocked(reviewGrammar).mockRejectedValueOnce(new GrammarReviewError(code))
    await expect(generateKnowledgeCard({ ...options, requestId: id })).rejects.toThrow()
    await expect(generateKnowledgeCard({ ...options, requestId: `${id}-retry`, retryOfRequestId: id })).resolves.toEqual(card)
    expect(generateProviderText).toHaveBeenCalledTimes(1)
    expect(reviewGrammar).toHaveBeenCalledTimes(2)
    await generateKnowledgeCard({ ...options, requestId: `${id}-new` })
    expect(generateProviderText).toHaveBeenCalledTimes(2)
  }
)

it('keeps the accepted route with the draft across transient retry failures', async () => {
  const retryContextFingerprint = 'original-inputs'
  vi.mocked(reviewGrammar)
    .mockRejectedValueOnce(new GrammarReviewError('timeout'))
    .mockRejectedValueOnce(new GrammarReviewError('network_failed'))
  await expect(generateKnowledgeCard({ ...options, requestId: 'route-first', retryContextFingerprint })).rejects.toThrow()
  const route = getResumableDraftClassification('route-first', retryContextFingerprint)
  expect(route).toEqual(classification)
  await expect(generateKnowledgeCard({ ...options, requestId: 'route-second', retryOfRequestId: 'route-first',
    retryContextFingerprint, request: { ...options.request, classification: route! } })).rejects.toThrow()
  expect(getResumableDraftClassification('route-first', retryContextFingerprint)).toBeUndefined()
  expect(getResumableDraftClassification('route-second', retryContextFingerprint)).toEqual(classification)
  await generateKnowledgeCard({ ...options, requestId: 'route-third', retryOfRequestId: 'route-second', retryContextFingerprint })
  expect(getResumableDraftClassification('route-second', retryContextFingerprint)).toBeUndefined()
  expect(generateProviderText).toHaveBeenCalledTimes(1)
  expect(reviewGrammar).toHaveBeenCalledTimes(3)
})

it.each(['language', 'model', 'provider', 'key', 'question', 'context', 'modules'])(
  'regenerates if %s changes before retry', async field => {
    const id = `changed-${field}`
    vi.mocked(reviewGrammar).mockRejectedValueOnce(new GrammarReviewError('timeout'))
    await expect(generateKnowledgeCard({ ...options, requestId: id })).rejects.toThrow()
    const changed = { ...options, requestId: `${id}-retry`, retryOfRequestId: id,
      ...(field === 'language' ? { answerLanguage: 'en' as const } : {}),
      ...(field === 'model' ? { modelName: 'other-model' } : {}),
      ...(field === 'provider' ? { modelProvider: 'deepseek' as const } : {}),
      ...(field === 'key' ? { apiKey: 'other-key' } : {}),
      request: { ...options.request,
        ...(field === 'question' ? { sourceQuestion: 'Explain rain.' } : {}),
        ...(field === 'context' ? { recentContext: [{ role: 'user' as const, content: 'rain' }] } : {}),
        ...(field === 'modules' ? { classification: { ...classification, modules: ['meaning', 'examples'] as typeof classification.modules } } : {}) }
    }
    await generateKnowledgeCard(changed)
    expect(generateProviderText).toHaveBeenCalledTimes(2)
  }
)

it('chains transient failures without regenerating or returning unreviewed content', async () => {
  vi.mocked(reviewGrammar).mockRejectedValueOnce(new GrammarReviewError('timeout'))
    .mockRejectedValueOnce(new GrammarReviewError('network_failed'))
  await expect(generateKnowledgeCard({ ...options, requestId: 'chain-1' })).rejects.toThrow()
  await expect(generateKnowledgeCard({ ...options, requestId: 'chain-2', retryOfRequestId: 'chain-1' })).rejects.toThrow()
  await expect(generateKnowledgeCard({ ...options, requestId: 'chain-3', retryOfRequestId: 'chain-2' })).resolves.toEqual(card)
  expect(generateProviderText).toHaveBeenCalledTimes(1)
})

it('retains the original draft after invalid review responses but not cancellation', async () => {
  vi.mocked(reviewGrammar).mockRejectedValueOnce(new GrammarReviewError('invalid_json'))
  await expect(generateKnowledgeCard({ ...options, requestId: 'invalid-review' })).rejects.toThrow()
  await generateKnowledgeCard({ ...options, retryOfRequestId: 'invalid-review' })
  expect(generateProviderText).toHaveBeenCalledTimes(1)
  const controller = new AbortController()
  vi.mocked(reviewGrammar).mockImplementationOnce(async () => {
    controller.abort(new Error('Stopped'))
    throw new GrammarReviewError('timeout')
  })
  await expect(generateKnowledgeCard({ ...options, requestId: 'cancelled-review', signal: controller.signal })).rejects.toThrow('Stopped')
  await generateKnowledgeCard({ ...options, retryOfRequestId: 'cancelled-review' })
  expect(generateProviderText).toHaveBeenCalledTimes(3)
})

it('revalidates a resumed review and rejects corrupt corrections', async () => {
  vi.mocked(reviewGrammar).mockRejectedValueOnce(new GrammarReviewError('timeout'))
    .mockResolvedValueOnce({ ...card, targets: ['snow'] })
  await expect(generateKnowledgeCard({ ...options, requestId: 'corrupt-resume' })).rejects.toThrow()
  await expect(generateKnowledgeCard({ ...options, retryOfRequestId: 'corrupt-resume' })).rejects.toThrow('invalid_reviewed_card')
  expect(generateProviderText).toHaveBeenCalledTimes(1)
})
