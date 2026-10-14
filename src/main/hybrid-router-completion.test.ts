import { beforeEach, expect, it, vi } from 'vitest'
import { classifyWithHybridRouter } from './hybrid-router'
import { classifyWithJev } from './jev-router'
import { generateProviderText } from './provider-adapters'
import { ROUTER_CLASSIFIER_PROMPT } from '../shared/prompt-design'

vi.mock('./jev-router', async importOriginal => ({ ...await importOriginal<typeof import('./jev-router')>(), classifyWithJev: vi.fn() }))
vi.mock('./provider-adapters', async importOriginal => ({ ...await importOriginal<typeof import('./provider-adapters')>(), generateProviderText: vi.fn() }))
const labels = { inputType: 'comparison', structureType: 'multi_target_comparison', intent: 'compare_difference', responseMode: 'card' } as const
const completion = { targetText: 'say vs tell', targets: ['say', 'tell'], focusText: '', modules: ['comparison', 'examples'],
  confidence: 0.95, needsClarification: false, clarificationQuestion: '' }
const options = { apiKey: 'test-answer-key', jevApiKey: 'test-jev-key', modelProvider: 'deepseek' as const, modelName: 'test-model',
  request: { requestId: 'completion-integration', question: 'say 和 tell 有什么区别？', history: [] } }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(classifyWithJev).mockResolvedValue({ labels, model: 'test-jev', elapsedMs: 1,
    confidence: { inputType: 0.9, structureType: 0.95, intent: 0.95, responseMode: 0.95 } })
})

it('uses the dedicated prompt and merges validated details with Jev labels', async () => {
  vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify(completion))
  const routing = vi.fn()
  expect(await classifyWithHybridRouter({ ...options, onRouting: routing })).toEqual({ ...completion, ...labels, confidence: 0.9 })
  expect(generateProviderText).toHaveBeenCalledTimes(1)
  expect(vi.mocked(generateProviderText).mock.calls[0][0].systemPrompt).not.toContain(ROUTER_CLASSIFIER_PROMPT)
  expect(routing).toHaveBeenLastCalledWith({ source: 'jev-assisted', channel: 'openrouter' })
})

it('returns to the original Router after two invalid completion attempts', async () => {
  vi.mocked(generateProviderText).mockResolvedValueOnce('{}').mockResolvedValueOnce('{}')
    .mockResolvedValueOnce(JSON.stringify({ ...labels, ...completion }))
  const routing = vi.fn()
  expect(await classifyWithHybridRouter({ ...options, onRouting: routing })).toEqual({ ...labels, ...completion })
  expect(generateProviderText).toHaveBeenCalledTimes(3)
  expect(vi.mocked(generateProviderText).mock.calls[2][0].systemPrompt).toBe(ROUTER_CLASSIFIER_PROMPT)
  expect(routing).toHaveBeenLastCalledWith({ source: 'jev-fallback', channel: 'openrouter' })
})

it('cancels during completion without retrying or starting the original Router', async () => {
  const controller = new AbortController()
  vi.mocked(generateProviderText).mockImplementation(async () => { controller.abort(); throw new Error('cancelled') })
  await expect(classifyWithHybridRouter({ ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(generateProviderText).toHaveBeenCalledTimes(1)
})
