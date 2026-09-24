import { beforeEach, expect, it, vi } from 'vitest'
import { classifyWithHybridRouter, JEV_ROUTING_MIN_CONFIDENCE } from './hybrid-router'
import { classifyWithJev, type JevRouterResult } from './jev-router'
import { classifyEnglishRequest } from './router-classifier'
import type { RouterClassification } from '../shared/router'

vi.mock('./jev-router', async importOriginal => ({
  ...await importOriginal<typeof import('./jev-router')>(), classifyWithJev: vi.fn()
}))
vi.mock('./router-classifier', async importOriginal => ({
  ...await importOriginal<typeof import('./router-classifier')>(), classifyEnglishRequest: vi.fn()
}))
const options = { apiKey: 'generation-secret', modelName: 'current-model', modelProvider: 'deepseek' as const,
  jevApiKey: 'routing-secret', request: { requestId: 'test', question: 'resilient 是什么意思？', history: [] } }
const result = (): JevRouterResult => ({ model: 'typesafe/jev-1.13', elapsedMs: 100,
  labels: { inputType: 'word', structureType: 'single_word', intent: 'explain_meaning', responseMode: 'card' },
  confidence: { inputType: 0.99, structureType: 0.99, intent: 0.99, responseMode: 0.99 } })
const original: RouterClassification = { ...result().labels, confidence: 0.9, targetText: 'resilient',
  targets: ['resilient'], focusText: '', modules: ['meaning'], needsClarification: false, clarificationQuestion: '' }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(classifyWithJev).mockResolvedValue(result())
  vi.mocked(classifyEnglishRequest).mockResolvedValue(original)
})

it.each(['resilient', ' hello ', 'help', 'test', 'Resilient', 'well-known', "don't"])(
  'routes bare %s without any classification API, with or without Jev', async question => {
    for (const jevApiKey of ['routing-secret', undefined]) {
      const classification = await classifyWithHybridRouter({ ...options, jevApiKey,
        request: { ...options.request, question } })
      expect(classification).toEqual({ inputType: 'word', structureType: 'single_word', intent: 'explain_meaning',
        targetText: question.trim(), targets: [question.trim()], focusText: '',
        modules: ['meaning', 'phonetic', 'usage', 'examples'], responseMode: 'card', confidence: 1,
        needsClarification: false, clarificationQuestion: '' })
    }
    expect(classifyWithJev).not.toHaveBeenCalled()
    expect(classifyEnglishRequest).not.toHaveBeenCalled()
})

it.each(['take off', 'hello there', 'Explain resilient.', '中文', 'word123', '', 'word\nword', 'hello?'])(
  'leaves non-bare input %s to the existing model route', async question => {
    await classifyWithHybridRouter({ ...options, jevApiKey: undefined, request: { ...options.request, question } })
    expect(classifyEnglishRequest).toHaveBeenCalledTimes(1)
  })

it('checks cancellation before the local word rule', async () => {
  await expect(classifyWithHybridRouter({ ...options, request: { ...options.request, question: 'resilient' },
    signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
  expect(classifyWithJev).not.toHaveBeenCalled()
  expect(classifyEnglishRequest).not.toHaveBeenCalled()
})

it.each(['resilient 是什么意思？', 'take off', 'what does resilient mean?'])('completes extracted fields for %s with the original provider', async question => {
  expect(await classifyWithHybridRouter({ ...options, request: { ...options.request, question } })).toEqual(original)
  expect(classifyEnglishRequest).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'generation-secret',
    modelProvider: 'deepseek', modelName: 'current-model', requiredLabels: result().labels }))
})

it('retains context even for a one-word follow-up', async () => {
  await classifyWithHybridRouter({ ...options, request: { ...options.request,
    question: 'resilient',
    history: [{ id: 'old', role: 'user', content: 'Compare it with durable.', createdAt: '2026-09-24' }] } })
  expect(classifyEnglishRequest).toHaveBeenCalled()
})

it('uses original routing unchanged when no Jev key exists', async () => {
  expect(await classifyWithHybridRouter({ ...options, jevApiKey: undefined })).toBe(original)
  expect(classifyWithJev).not.toHaveBeenCalled()
  expect(vi.mocked(classifyEnglishRequest).mock.calls[0][0]).not.toHaveProperty('requiredLabels')
})

it.each(['low confidence', 'inconsistent structure', 'unknown card'])('falls back for %s', async reason => {
  const candidate = result()
  if (reason === 'low confidence') candidate.confidence.intent = JEV_ROUTING_MIN_CONFIDENCE - 0.01
  if (reason === 'inconsistent structure') candidate.labels.structureType = 'long_text'
  if (reason === 'unknown card') candidate.labels.intent = 'unknown'
  vi.mocked(classifyWithJev).mockResolvedValue(candidate)
  expect(await classifyWithHybridRouter(options)).toBe(original)
  const call = vi.mocked(classifyEnglishRequest).mock.calls[0][0]
  expect(call).not.toHaveProperty('requiredLabels')
  expect(call).not.toHaveProperty('jevApiKey')
})

it.each(['HTTP 402', 'HTTP 429', 'timed out', 'invalid JSON'])('falls back on %s', async failure => {
  vi.mocked(classifyWithJev).mockRejectedValue(new Error(failure))
  expect(await classifyWithHybridRouter(options)).toBe(original)
  expect(classifyEnglishRequest).toHaveBeenCalledTimes(1)
})

it('falls back without label constraints if completion fails', async () => {
  vi.mocked(classifyEnglishRequest).mockRejectedValueOnce(new Error('bad completion')).mockResolvedValueOnce(original)
  expect(await classifyWithHybridRouter({ ...options, request: { ...options.request, question: 'Explain resilient.' } })).toBe(original)
  expect(vi.mocked(classifyEnglishRequest).mock.calls[0][0]).toHaveProperty('requiredLabels')
  expect(vi.mocked(classifyEnglishRequest).mock.calls[1][0]).not.toHaveProperty('requiredLabels')
})

it('does not swallow cancellation or issue fallback calls', async () => {
  const controller = new AbortController()
  vi.mocked(classifyWithJev).mockImplementation(async () => { controller.abort(); throw new Error('cancelled') })
  await expect(classifyWithHybridRouter({ ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(classifyEnglishRequest).not.toHaveBeenCalled()
})

it('preserves original errors after a failed Jev call', async () => {
  vi.mocked(classifyWithJev).mockRejectedValue(new Error('Jev failed'))
  vi.mocked(classifyEnglishRequest).mockRejectedValue(new Error('Original failed'))
  await expect(classifyWithHybridRouter(options)).rejects.toThrow('Original failed')
})


it('passes the selected channel and account to Jev, and keeps fallback credentials separate', async () => {
  const jevConfiguration = { channel: 'cloudflare' as const, apiKey: 'cf-key', accountId: '0123456789abcdef0123456789abcdef' }
  vi.mocked(classifyWithJev).mockRejectedValue(new Error('provider unavailable'))
  await classifyWithHybridRouter({ ...options, jevConfiguration })
  expect(classifyWithJev).toHaveBeenCalledWith(expect.objectContaining(jevConfiguration))
  expect(classifyEnglishRequest).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'generation-secret' }))
  expect(vi.mocked(classifyEnglishRequest).mock.calls[0][0]).not.toHaveProperty('jevConfiguration')
})


it('reports actual routing paths independently of classification JSON', async () => {
  const onRouting = vi.fn()
  await classifyWithHybridRouter({ ...options, onRouting, request: { ...options.request, question: 'word' } })
  expect(onRouting).toHaveBeenLastCalledWith({ source: 'rule' })
  await classifyWithHybridRouter({ ...options, jevApiKey: undefined, onRouting })
  expect(onRouting).toHaveBeenLastCalledWith({ source: 'original' })
  await classifyWithHybridRouter({ ...options, onRouting })
  expect(onRouting).toHaveBeenLastCalledWith({ source: 'jev-assisted', channel: 'openrouter' })
  vi.mocked(classifyWithJev).mockRejectedValue(new Error('failed'))
  await classifyWithHybridRouter({ ...options, onRouting })
  expect(onRouting).toHaveBeenLastCalledWith({ source: 'jev-fallback', channel: 'openrouter' })
  vi.mocked(classifyWithJev).mockResolvedValue({ ...result(), confidence: { ...result().confidence, intent: 0.2 } })
  await classifyWithHybridRouter({ ...options, onRouting })
  expect(onRouting).toHaveBeenLastCalledWith({ source: 'jev-fallback', channel: 'openrouter' })
  expect(vi.mocked(classifyEnglishRequest).mock.lastCall?.[0]).not.toHaveProperty('onRouting')
})
