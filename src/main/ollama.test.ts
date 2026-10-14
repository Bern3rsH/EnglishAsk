import { afterEach, expect, it, vi } from 'vitest'
import { generateProviderText } from './provider-adapters'
import { listOllamaModels } from './ollama'
import { listProviderModels } from './provider-models'

vi.mock('./settings', () => ({
  getConfiguredOllamaBaseUrl: vi.fn().mockResolvedValue('http://192.168.1.20:11435')
}))

it('uses a draft address for tags/show and the saved address when omitted', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ models: [{ name: 'qwen3:8b' }] }))
    .mockResolvedValueOnce(response({ capabilities: ['completion'] }))
    .mockResolvedValueOnce(response({ models: [] }))
  vi.stubGlobal('fetch', fetchMock)
  await listProviderModels({ modelProvider: 'ollama', ollamaBaseUrl: 'https://ollama.example.com/' })
  await listProviderModels({ modelProvider: 'ollama' })
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
    'https://ollama.example.com/api/tags', 'https://ollama.example.com/api/show',
    'http://192.168.1.20:11435/api/tags'
  ])
})

it('rejects an invalid endpoint before making network requests', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  await expect(listProviderModels({ modelProvider: 'ollama', ollamaBaseUrl: 'http://user:secret@localhost' }))
    .rejects.toThrow('Ollama 服务地址')
  expect(fetchMock).not.toHaveBeenCalled()
})

afterEach(() => vi.unstubAllGlobals())
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const options = { modelProvider: 'ollama' as const, modelName: 'qwen3:8b', apiKey: '',
  systemPrompt: 'Explain English.', prompt: 'hello' }

it('discovers installed text completion models, deduplicates and rejects vision/embedding models', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ models: [
    { name: 'qwen3:8b' }, { name: 'qwen3:8b' }, { name: 'llava:7b' }, { name: 'nomic-embed-text' }
  ] })).mockResolvedValueOnce(response({ capabilities: ['completion', 'tools'] }))
    .mockResolvedValueOnce(response({ capabilities: ['completion', 'vision'] }))
  vi.stubGlobal('fetch', fetchMock)
  expect(await listOllamaModels()).toEqual(['qwen3:8b'])
  expect(fetchMock).toHaveBeenCalledTimes(3)
  expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/tags')
})

it('returns an empty installed list without inventing defaults', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ models: [] })))
  expect(await listOllamaModels()).toEqual([])
})

it('uses native non-streaming JSON mode without Authorization and ignores thinking content', async () => {
  const fetchMock = vi.fn().mockResolvedValue(response({ done: true,
    message: { content: '{"answer":"hello"}', thinking: 'not user output' } }))
  vi.stubGlobal('fetch', fetchMock)
  expect(await generateProviderText({ ...options, responseFormat: 'json' })).toBe('{"answer":"hello"}')
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('http://192.168.1.20:11435/api/chat')
  expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
  expect(init.redirect).toBe('error')
  expect(JSON.parse(init.body)).toMatchObject({ model: 'qwen3:8b', stream: false, format: 'json',
    messages: [{ role: 'system', content: 'Explain English.' }, { role: 'user', content: 'hello' }] })
})

it('preserves cancellation before sending a request', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const controller = new AbortController()
  controller.abort()
  await expect(generateProviderText({ ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetchMock).not.toHaveBeenCalled()
})

it('reports local service unavailability without leaking response/error content', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret request data')))
  await expect(listOllamaModels()).rejects.toThrow('无法连接 Ollama')
})

it.each([{}, { message: { content: 'partial' }, done: false },
  { message: { content: '' }, done: true }, { message: { content: 'cut' }, done: true, done_reason: 'length' }])(
  'rejects invalid or unfinished responses %j', async data => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)))
    await expect(generateProviderText(options)).rejects.toThrow('Ollama')
  })

it('reports a removed model with an actionable error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'private-data' }, 404)))
  await expect(generateProviderText(options)).rejects.toThrow('确认模型已安装')
})
