import { afterEach, expect, it, vi } from 'vitest'
import { generateProviderText } from './provider-adapters'

afterEach(() => vi.restoreAllMocks())

it.each([
  ['deepseek-v4-flash', 'grammar-review', 'none'],
  ['deepseek-v4-pro', 'grammar-review', 'none'],
  ['deepseek-v4-flash', 'routing', undefined],
  ['deepseek-v4-flash', 'card-generation', undefined],
  ['deepseek-reasoner', 'grammar-review', undefined]
] as const)('serializes actual SDK request: %s %s', async (modelName, purpose, effort) => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    id: 'test-completion', object: 'chat.completion', created: 1, model: modelName,
    choices: [{ index: 0, message: { role: 'assistant', content: '{"corrections":[]}' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  await expect(generateProviderText({ apiKey: 'test-only', modelProvider: 'deepseek', modelName,
    purpose, prompt: 'Review this fixture.', systemPrompt: 'Return JSON.', responseFormat: 'json' }))
    .resolves.toBe('{"corrections":[]}')
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url, init] = fetch.mock.calls[0]
  expect(String(url)).toBe('https://api.deepseek.com/v1/chat/completions')
  const body = JSON.parse(init!.body as string)
  expect(body.reasoning_effort).toBe(effort)
  expect(body.model).toBe(modelName)
  expect(body.response_format).toEqual({ type: 'json_object' })
})
