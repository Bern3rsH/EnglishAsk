import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { KnowledgeCard } from '../shared/knowledge-card'
import type { RouterClassification } from '../shared/router'
import { GRAMMAR_ACCURACY_RULES } from '../shared/prompt-design'
import { generateProviderText } from './provider-adapters'
import { applyGrammarCorrections, GRAMMAR_REVIEW_TIMEOUT_MS, GrammarReviewError, needsGrammarReview, reviewGrammar } from './grammar-review'

vi.mock('./provider-adapters', () => ({ generateProviderText: vi.fn() }))
const classification: RouterClassification = {
  inputType: 'pattern', structureType: 'pattern', targetText: 'ask sb to do',
  targets: ['ask sb to do'], focusText: '', intent: 'explain_grammar',
  modules: ['grammar', 'examples'], confidence: 0.9, needsClarification: false,
  clarificationQuestion: '', responseMode: 'card'
}
const draft: KnowledgeCard = {
  cardType: 'pattern', targetText: 'ask sb to do', targets: ['ask sb to do'],
  answer: '请求某人做某事。',
  sections: [{ module: 'grammar', content: 'sb 是间接宾语。' },
    { module: 'examples', content: '1. She asked me to wait.\n   她让我等一下。' }]
}
const providerOptions = {
  apiKey: 'test-key', modelName: 'test-model', modelProvider: 'openai' as const,
  prompt: JSON.stringify({ sourceQuestion: '讲解 ask sb to do', settings: { answerLanguage: 'zh' } })
}
const correction = {
  field: 'grammar', quote: 'sb 是间接宾语。', reason: 'This is not a double-object construction.',
  replacement: 'sb 是 ask 的宾语；后接带 to 的不定式。'
}
beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it.each([
  ['sb 是间接宾语。', 'sb 是 ask 的宾语。'],
  ['go 的被动语态用 be gone。', 'go 表示移动时通常不用于普通被动语态；完成时使用 have/has gone。'],
  ['一般过去时与现在完全无关。', '一般过去时把事件放在过去的时间框架中；事件仍可能影响现在。'],
  ['The past simple has no connection whatsoever with the present.', 'The past simple locates events in a past time frame; their consequences may still matter now.'],
  ['没有提到具体过去时间就必须用现在完成时。', '未提到具体时间不足以决定时态；上下文也可以提供已结束的过去时间框架，此时可以用一般过去时。'],
  ['Use the present perfect whenever no specific past time is mentioned.', 'The absence of a time expression does not determine tense: context may establish a finished past time frame for the past simple.'],
  ['只要对现在有影响，就不能用一般过去时。', '过去事件对现在有影响并不排除一般过去时；时态选择还取决于说话者采用的时间框架。'],
  ['The present perfect only describes completed actions with a result now.', 'The present perfect can also describe states or activities continuing up to now; its interpretation depends on context.'],
  ['when 是过去时间标志，所以不能与现在完成时搭配。', 'when 本身不决定时态；要看整个从句的时间含义，例如 when you have finished 可以表示在未来某个动作之前完成。'],
  ['Every when-clause refers to finished past time and excludes the present perfect.', 'A when-clause can refer to different time frames; when you have finished can mark completion before a future action.'],
  ['过去分词的形式一定不同于一般过去式。', '过去分词和过去式的语法功能不同，但形式可以相同，例如 worked/worked 和 bought/bought；went/gone 则不同。'],
  ['A past participle always has a different form from the past simple.', 'Past participles and past-simple forms have different grammatical roles but may share a form, as in worked/worked and bought/bought.']
])('applies a grounded field-local correction for regression: %s', async (bad, good) => {
  const original: KnowledgeCard = { ...draft, sections: [{ module: 'grammar', content: bad }, draft.sections[1]] }
  vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify({
    corrections: [{ ...correction, quote: bad, replacement: good }]
  }))
  const result = await reviewGrammar(original, classification, providerOptions)
  expect(result.sections[0].content).toBe(good)
  expect(result.sections[0].content).not.toContain(bad)
  expect(result.sections[1]).toBe(original.sections[1])
  expect(result.targets).toEqual(original.targets)
  expect(result.answer).toBe(original.answer)
  expect(original.sections[0].content).toBe(bad)
  expect(generateProviderText).toHaveBeenCalledTimes(1)
})

it('preserves a correct answer including a valid absolute rule', async () => {
  const original: KnowledgeCard = { ...draft, answer: 'In take it off, the unstressed personal pronoun must precede off.' }
  vi.mocked(generateProviderText).mockResolvedValue('{"corrections":[]}')
  expect(await reviewGrammar(original, classification, providerOptions)).toBe(original)
  expect(GRAMMAR_ACCURACY_RULES).toContain('do not weaken correct rules')
})

it.each([
  'Perfect have/has selects a past participle; worked and bought can each be either a past-simple form or a past participle, depending on the construction.',
  'when 本身不决定时态；when I was a child 给出已结束的过去时间，而 when you have finished 可以表示未来某个动作之前完成。'
])('preserves a correctly scoped morphology or time-frame explanation: %s', async content => {
  const original: KnowledgeCard = { ...draft, sections: [{ module: 'grammar', content }] }
  vi.mocked(generateProviderText).mockResolvedValue('{"corrections":[]}')
  expect(await reviewGrammar(original, classification, providerOptions)).toBe(original)
  expect(generateProviderText).toHaveBeenCalledTimes(1)
})

it.each([
  { ...correction, field: 'new_module' },
  { ...correction, field: 'targetText' },
  { ...correction, quote: 'invented quotation' },
  { ...correction, reason: '' },
  { ...correction, replacement: '' },
  { ...correction, replacement: correction.quote },
  { ...correction, replacement: 'a'.repeat(20_001) }
])('rejects invalid or ungrounded correction %#', (invalid) => {
  expect(() => applyGrammarCorrections(draft, JSON.stringify({ corrections: [invalid] }))).toThrow()
})
it('rejects duplicate corrections and malformed response shapes', () => {
  for (const output of ['invalid', 'null', '{}', '{"corrections":{}}', JSON.stringify({ corrections: [correction, correction] })]) {
    expect(() => applyGrammarCorrections(draft, output)).toThrow()
  }
})
it('supports an answer-only correction without changing sections', () => {
  const result = applyGrammarCorrections(draft, JSON.stringify({
    corrections: [{ field: 'answer', quote: draft.answer, reason: 'Clarify scope.', replacement: '这个句型表达请求或要求某人做某事。' }]
  }))
  expect(result.correctionCount).toBe(1)
  expect(result.card.sections).toEqual(draft.sections)
})
it('skips translation even when the answer contains grammatical assertions', async () => {
  const translation: KnowledgeCard = { cardType: 'word', targetText: '药物', targets: ['药物'], answer: 'medicine',
    sections: [{ module: 'translation', content: 'medicine' }] }
  const route = { ...classification, inputType: 'word' as const, intent: 'translate' as const, modules: ['translation' as const] }
  expect(await reviewGrammar(translation, route, providerOptions)).toBe(translation)
  expect(generateProviderText).not.toHaveBeenCalled()
  expect(needsGrammarReview({ ...translation, answer: 'This verb cannot take an object.' }, route)).toBe(false)
})
it('sends existing learning context and draft as data without credential leakage', async () => {
  vi.mocked(generateProviderText).mockResolvedValue('{"corrections":[]}')
  await reviewGrammar(draft, classification, providerOptions)
  const options = vi.mocked(generateProviderText).mock.calls[0][0]
  expect(JSON.parse(options.prompt).draft).toEqual(draft)
  expect(JSON.parse(options.prompt).editableFields).toEqual(['answer', 'grammar', 'examples'])
  expect(options.prompt).not.toContain(providerOptions.apiKey)
  expect(options.systemPrompt).toContain('untrusted learning data')
  expect(options.systemPrompt).toContain(GRAMMAR_ACCURACY_RULES)
  expect(options.purpose).toBe('grammar-review')
})

it('lists exactly the existing structured example fields for the reviewer', async () => {
  vi.mocked(generateProviderText).mockResolvedValue('{"corrections":[]}')
  await reviewGrammar({ ...draft, sections: [{ module: 'examples', content: '', examples: [
    { english: 'I left.', translation: '我走了。' }, { english: 'She stayed.' }
  ] }] }, classification, providerOptions)
  expect(JSON.parse(vi.mocked(generateProviderText).mock.calls[0][0].prompt).editableFields).toEqual([
    'answer', 'examples', 'examples.examples.0.english', 'examples.examples.0.translation', 'examples.examples.1.english'
  ])
})
it.each(['invalid JSON', '{"corrections":[{"field":"grammar"}]}'])('fails closed on bad review without retrying: %s', async output => {
  vi.mocked(generateProviderText).mockResolvedValue(output)
  await expect(reviewGrammar(draft, classification, providerOptions)).rejects.toBeInstanceOf(GrammarReviewError)
  expect(generateProviderText).toHaveBeenCalledTimes(1)
})
it('fails closed on provider failure', async () => {
  vi.mocked(generateProviderText).mockRejectedValue(new Error('offline'))
  await expect(reviewGrammar(draft, classification, providerOptions)).rejects.toBeInstanceOf(GrammarReviewError)
})
it('enforces a deadline even if the provider ignores cancellation', async () => {
  vi.useFakeTimers()
  vi.mocked(generateProviderText).mockReturnValue(new Promise(() => {}))
  const pending = reviewGrammar(draft, classification, providerOptions)
  const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout', elapsedMs: GRAMMAR_REVIEW_TIMEOUT_MS })
  await vi.advanceTimersByTimeAsync(GRAMMAR_REVIEW_TIMEOUT_MS)
  await assertion
  expect(vi.mocked(generateProviderText).mock.calls[0][0].signal?.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
it('cancels only the affected review and does not retry', async () => {
  vi.mocked(generateProviderText).mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce('{"corrections":[]}')
  const controller = new AbortController()
  const first = reviewGrammar(draft, classification, { ...providerOptions, signal: controller.signal })
  const aborted = expect(first).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await aborted
  expect(await reviewGrammar(draft, classification, providerOptions)).toBe(draft)
  expect(generateProviderText).toHaveBeenCalledTimes(2)
})
it('does not call the provider if already cancelled', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(reviewGrammar(draft, classification, { ...providerOptions, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(generateProviderText).not.toHaveBeenCalled()
})

it.each([
  [401, 'authentication_failed'], [403, 'authentication_failed'], [429, 'rate_limited'],
  [503, 'provider_unavailable'], [400, 'request_failed']
])('classifies nested provider HTTP %s without logging sensitive payloads', async (statusCode, code) => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(generateProviderText).mockRejectedValue({
    message: 'secret-key private-question', lastError: { statusCode, responseBody: 'private-answer' }
  })
  await expect(reviewGrammar(draft, classification, providerOptions)).rejects.toMatchObject({ code, statusCode, elapsedMs: expect.any(Number) })
  expect(warn).toHaveBeenCalledWith('EnglishAsk grammar review failed', expect.objectContaining({ stage: 'request', code, statusCode }))
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret-key|private-question|private-answer|test-key/)
})

it('classifies network causes and handles circular or unknown errors', async () => {
  vi.mocked(generateProviderText).mockRejectedValueOnce({ cause: { code: 'ENOTFOUND' } })
  await expect(reviewGrammar(draft, classification, providerOptions)).rejects.toMatchObject({ code: 'network_failed' })
  const circular: { cause?: unknown } = {}
  circular.cause = circular
  for (const error of [circular, null, 'private-provider-error']) {
    vi.mocked(generateProviderText).mockRejectedValueOnce(error)
    await expect(reviewGrammar(draft, classification, providerOptions)).rejects.toMatchObject({ code: 'request_failed' })
  }
})

it.each([
  ['bad JSON with private data', 'invalid_json'],
  ['{}', 'invalid_response'],
  ['x'.repeat(300_001), 'response_too_large'],
  [JSON.stringify({ corrections: [{ ...correction, field: 'missing' }] }), 'unknown_field'],
  [JSON.stringify({ corrections: [{ ...correction, quote: 'missing' }] }), 'quote_mismatch'],
  [JSON.stringify({ corrections: [correction, correction] }), 'duplicate_correction'],
  [JSON.stringify({ corrections: [{ ...correction, replacement: '' }] }), 'invalid_replacement'],
  [JSON.stringify({ corrections: [{ ...correction, reason: '' }] }), 'invalid_correction']
])('retains validation category %#', async (output, code) => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(generateProviderText).mockResolvedValue(output)
  await expect(reviewGrammar(draft, classification, providerOptions)).rejects.toMatchObject({ code, message: expect.stringContaining(`[${code}]`) })
  expect(warn).toHaveBeenCalledWith('EnglishAsk grammar review failed', expect.objectContaining({ code, stage: 'validate', elapsedMs: expect.any(Number) }))
  expect(JSON.stringify(warn.mock.calls)).not.toContain('private data')
})

it('distinguishes invalid request preparation from invalid model JSON', async () => {
  await expect(reviewGrammar(draft, classification, { ...providerOptions, prompt: 'bad' }))
    .rejects.toMatchObject({ code: 'internal_error' })
  expect(generateProviderText).not.toHaveBeenCalled()
})
