import { afterEach, expect, it, vi } from 'vitest'
import { generateProviderText, ProviderEmptyResponseError } from './provider-adapters'

afterEach(() => vi.restoreAllMocks())
const options = { modelProvider: 'anthropic' as const, modelName: 'claude-sonnet-5', apiKey: 'test-key',
  prompt: 'Explain the expression.', systemPrompt: 'Answer in Chinese.' }

it.each(['json', undefined] as const)('uses official Messages authentication and extracts only text (%s)', async responseFormat => {
  const text = responseFormat ? '{"meaning":"test"}' : 'A clear answer.'
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    content: [{ type: 'thinking', thinking: 'Not user-facing.' }, { type: 'text', text }], stop_reason: 'end_turn'
  })))
  expect(await generateProviderText({ ...options, responseFormat })).toBe(text)
  const [url, init] = fetch.mock.calls[0]
  expect(String(url)).toBe('https://api.anthropic.com/v1/messages')
  expect(init!.headers).toMatchObject({ 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01' })
  const body = JSON.parse(init!.body as string)
  expect(body.model).toBe(options.modelName)
  expect(body.max_tokens).toBeGreaterThan(0)
  expect(body.messages).toEqual([{ role: 'user', content: options.prompt }])
  expect(body.system).toContain(options.systemPrompt)
  if (responseFormat) expect(body.system).toContain('valid JSON object')
})

it('preserves cancellation on request and body reading', async () => {
  for (const phase of ['request', 'body']) {
    const controller = new AbortController()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (phase === 'request') {
        controller.abort()
        throw controller.signal.reason
      }
      const response = new Response('{}')
      vi.spyOn(response, 'json').mockImplementation(async () => {
        controller.abort()
        throw controller.signal.reason
      })
      return response
    })
    await expect(generateProviderText({ ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  }
})

it('rejects truncated, malformed and empty responses', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: 'text', text: 'partial' }], stop_reason: 'max_tokens' })))
  await expect(generateProviderText(options)).rejects.toThrow('输出上限')
  fetch.mockResolvedValueOnce(new Response('{}'))
  await expect(generateProviderText(options)).rejects.toThrow('format is invalid')
  fetch.mockResolvedValueOnce(new Response('{"content":[]}'))
  await expect(generateProviderText(options)).rejects.toBeInstanceOf(ProviderEmptyResponseError)
})

it.each([401, 403, 429, 500])('sanitizes HTTP %s provider errors', async status => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('test-key', { status }))
  const error: unknown = await generateProviderText(options).catch(error => error)
  expect(String(error)).toContain(String(status))
  expect(String(error)).not.toContain('test-key')
})
