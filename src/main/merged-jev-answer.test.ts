import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('./settings', () => ({ getConfiguredModelProvider: async () => 'deepseek',
  getConfiguredProviderModel: async () => 'test', getConfiguredSystemPrompt: async () => 'Be helpful.',
  getStoredProviderApiKey: async () => 'test-key', getEnvironmentProviderApiKey: () => undefined }))
vi.mock('./jev-routing-config', () => ({ getJevRoutingConfiguration: async () => ({ channel: 'openrouter', apiKey: 'test-jev' }) }))
vi.mock('./rag-answer-service', () => ({ answerFromNotes: vi.fn() }))
vi.mock('./note-answer-routing', () => ({ decideNoteAnswerRoute: vi.fn() }))
vi.mock('./jev-router', async original => ({ ...await original<typeof import('./jev-router')>(), classifyWithJev: vi.fn() }))
vi.mock('./router-classifier', async original => ({ ...await original<typeof import('./router-classifier')>(), classifyEnglishRequest: vi.fn() }))
vi.mock('./provider-adapters', () => ({ generateProviderText: vi.fn(), askProviderText: vi.fn(), extractInteractionOutputText: vi.fn() }))
vi.mock('./grammar-review', async original => ({ ...await original<typeof import('./grammar-review')>(), reviewGrammar: vi.fn() }))
import { askEnglish } from './ai-service'
import { classifyWithJev } from './jev-router'
import { classifyEnglishRequest } from './router-classifier'
import { generateProviderText, askProviderText } from './provider-adapters'
import { reviewGrammar } from './grammar-review'
import type { RouterClassification } from '../shared/router'

const labels = { inputType: 'phrase', structureType: 'fixed_expression', intent: 'explain_meaning', responseMode: 'card' } as const
const completion = { targetText: 'take off', targets: ['take off'], focusText: '', modules: ['meaning'],
  confidence: 0.9, needsClarification: false, clarificationQuestion: '' }
const classification = { ...labels, ...completion } as RouterClassification
const card = { cardType: 'phrase', targetText: 'take off', targets: ['take off'], answer: '这里表示起飞。',
  sections: [{ module: 'meaning', content: '起飞。' }] }
const request = { requestId: 'merged-test', answerMode: 'standard', question: '它是什么意思？', history: [{ id: 'previous', role: 'user', content: 'take off', createdAt: '2026-10-13' }] }
const envelope = () => ({ completion: { ...completion }, card: { ...card }, answer: '' })
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(classifyWithJev).mockResolvedValue({ labels, confidence: { inputType: 0.99, structureType: 0.99, intent: 0.99, responseMode: 0.99 }, elapsedMs: 1, model: 'test' })
  vi.mocked(classifyEnglishRequest).mockResolvedValue(classification)
  vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify(envelope()))
  vi.mocked(reviewGrammar).mockImplementation(async draft => draft)
})
it('uses one generation call for completion and card, passes history and still reviews the validated card', async () => {
  const response = await askEnglish(request, { includeRouterDiagnostic: true })
  expect(response.knowledgeCard).toEqual(card)
  expect(response.routerDiagnostic).toMatchObject({ routing: { source: 'jev-assisted' }, classification })
  expect(generateProviderText).toHaveBeenCalledTimes(1)
  expect(vi.mocked(generateProviderText).mock.calls[0][0].prompt).toContain('take off')
  expect(classifyEnglishRequest).not.toHaveBeenCalled()
  expect(askProviderText).not.toHaveBeenCalled()
  expect(reviewGrammar).toHaveBeenCalledTimes(1)
})
it.each(['invalid JSON', 'mutated labels', 'wrong target', 'missing modules', 'missing examples', 'unexpected envelope key', 'transport failure'])(
  'falls back with unchanged context and no label constraint for %s', async failure => {
    const invalid = envelope()
    if (failure === 'mutated labels') Object.assign(invalid.completion, { intent: 'translate' })
    if (failure === 'wrong target') invalid.card.targets = ['wrong']
    if (failure === 'missing modules') invalid.card.sections = []
    if (failure === 'missing examples') invalid.completion.modules = ['examples']
    if (failure === 'unexpected envelope key') Object.assign(invalid, { extra: true })
    if (failure === 'transport failure') vi.mocked(generateProviderText).mockRejectedValueOnce(new Error('network'))
    else vi.mocked(generateProviderText).mockResolvedValueOnce(failure === 'invalid JSON' ? '{' : JSON.stringify(invalid))
    vi.mocked(generateProviderText).mockResolvedValueOnce(JSON.stringify(card))
    const response = await askEnglish(request, { includeRouterDiagnostic: true })
    expect(response.knowledgeCard).toEqual(card)
    expect(response.routerDiagnostic?.routing?.source).toBe('jev-fallback')
    expect(classifyEnglishRequest).toHaveBeenCalledTimes(1)
    const fallback = vi.mocked(classifyEnglishRequest).mock.calls[0][0]
    expect(fallback.request.question).toBe(request.question)
    expect(fallback.request.history).toEqual(request.history)
    expect(fallback).not.toHaveProperty('requiredLabels')
    expect(fallback).not.toHaveProperty('completeAcceptedLabels')
    expect(generateProviderText).toHaveBeenCalledTimes(2)
})
it('does not fall back or review when the merged request is cancelled', async () => {
  const controller = new AbortController()
  vi.mocked(generateProviderText).mockImplementation(async () => { controller.abort(); throw controller.signal.reason })
  await expect(askEnglish(request, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(classifyEnglishRequest).not.toHaveBeenCalled()
  expect(reviewGrammar).not.toHaveBeenCalled()
})
it('retains the split path for a controlled comparison', async () => {
  vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify(card))
  await askEnglish(request, { mergeJevAnswer: false })
  expect(classifyEnglishRequest).toHaveBeenCalledWith(expect.objectContaining({ requiredLabels: labels }))
  expect(generateProviderText).toHaveBeenCalledTimes(1)
})
it.each(['clarification', 'conversational'] as const)('returns merged %s without a second answer request', async responseMode => {
  vi.mocked(classifyWithJev).mockResolvedValue({ labels: { inputType: 'unknown', structureType: 'unknown', intent: 'unknown', responseMode },
    confidence: { inputType: 0.99, structureType: 0.99, intent: 0.99, responseMode: 0.99 }, elapsedMs: 1, model: 'test' })
  const clarification = responseMode === 'clarification'
  vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify({ completion: { targetText: '', targets: [], focusText: '', modules: [],
    confidence: 0.9, needsClarification: clarification, clarificationQuestion: clarification ? '想比较什么？' : '' },
    card: null, answer: clarification ? '' : '下次见！' }))
  const response = await askEnglish(request)
  expect(response.answer).toBe(clarification ? '想比较什么？' : '下次见！')
  expect(generateProviderText).toHaveBeenCalledTimes(1)
  expect(askProviderText).not.toHaveBeenCalled()
  expect(classifyEnglishRequest).not.toHaveBeenCalled()
})

it('reuses a merged draft after review failure without calling Jev or generation again', async () => {
  const firstRequest = { ...request, requestId: 'merged-review-original' }
  vi.mocked(reviewGrammar).mockRejectedValueOnce(new Error('review unavailable'))
  const first = await askEnglish(firstRequest)
  expect(first.warningStage).toBe('grammar')
  const retried = await askEnglish({ ...firstRequest, requestId: 'merged-review-retry', retryOfRequestId: firstRequest.requestId })
  expect(retried.knowledgeCard).toEqual(card)
  expect(generateProviderText).toHaveBeenCalledTimes(1)
  expect(classifyWithJev).toHaveBeenCalledTimes(1)
  expect(classifyEnglishRequest).not.toHaveBeenCalled()
  expect(reviewGrammar).toHaveBeenCalledTimes(2)
})
