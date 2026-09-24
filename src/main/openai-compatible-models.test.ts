import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { listOpenAICompatibleModels, MODEL_LIST_TIMEOUT_MS } from './openai-compatible-models'
import { getEnvironmentProviderApiKey, getStoredProviderApiKey } from './settings'

vi.mock('./settings', () => ({
  getStoredProviderApiKey: vi.fn(), getEnvironmentProviderApiKey: vi.fn()
}))
const fetchMock = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(getStoredProviderApiKey).mockResolvedValue('saved-key')
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'gpt-4.1' }] })))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it.each([
  ['openai', 'https://api.openai.com/v1/models'],
  ['openrouter', 'https://openrouter.ai/api/v1/models']
] as const)('fetches %s models with the unsaved key, without persisting it', async (provider, endpoint) => {
  await expect(listOpenAICompatibleModels(provider, '  override-key  ')).resolves.toEqual(['gpt-4.1'])
  expect(fetchMock).toHaveBeenCalledWith(endpoint, {
    headers: { Authorization: 'Bearer override-key' }, signal: expect.any(AbortSignal), redirect: 'error'
  })
  expect(getStoredProviderApiKey).not.toHaveBeenCalled()
})

it('uses saved credentials before the environment and falls back to the environment', async () => {
  vi.mocked(getEnvironmentProviderApiKey).mockReturnValue('environment-key')
  await listOpenAICompatibleModels('openai')
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer saved-key')
  vi.mocked(getStoredProviderApiKey).mockResolvedValue(undefined)
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'gpt-4.1' }] })))
  await listOpenAICompatibleModels('openrouter')
  expect(getStoredProviderApiKey).toHaveBeenLastCalledWith('openrouter')
  expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer environment-key')
})

it('rejects missing credentials without making a request', async () => {
  vi.mocked(getStoredProviderApiKey).mockResolvedValue(undefined)
  await expect(listOpenAICompatibleModels('openai')).rejects.toThrow('请先填写 OpenAI API 密钥')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('deduplicates, sorts and filters malformed and non-text OpenAI models', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [
    null, {}, { id: 1 }, { id: ' ' }, { id: 'bad model' }, { id: 'gpt-4.1-mini' },
    { id: 'gpt-4.1' }, { id: ' gpt-4.1 ' }, { id: 'text-embedding-3-small' },
    { id: 'whisper-1' }, { id: 'gpt-image-1' }, { id: 'sora-2' }, { id: 'davinci-002' }
  ] })))
  await expect(listOpenAICompatibleModels('openai')).resolves.toEqual(['gpt-4.1', 'gpt-4.1-mini'])
})

it('uses OpenRouter modality metadata so text-capable vision models remain available', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [
    { id: 'vendor/vision-model', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
    { id: 'vendor/image-only', architecture: { output_modalities: ['image'] } },
    { id: 'vendor/transcription', architecture: { input_modalities: ['audio'], output_modalities: ['text'] } },
    { id: 'vendor/chat' }
  ] })))
  await expect(listOpenAICompatibleModels('openrouter')).resolves.toEqual(['vendor/chat', 'vendor/vision-model'])
})

it.each([401, 403, 429, 500])('reports HTTP %s without forwarding secret-bearing error bodies', async status => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'saved-key' } }), { status }))
  const error = await listOpenAICompatibleModels('openai').catch(error => error as Error)
  if (!(error instanceof Error)) throw new Error('Expected model listing to fail')
  expect(error.message).toContain(String(status))
  expect(error.message).not.toContain('saved-key')
})

it.each([null, {}, { data: 'invalid' }, { data: [] }, { data: [{ id: 'whisper-1' }] }])('rejects invalid or empty model lists instead of substituting defaults: %j', async body => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body)))
  await expect(listOpenAICompatibleModels('openai')).rejects.toThrow(/格式异常|未返回可用/)
})

it('sanitizes network failures and invalid JSON', async () => {
  fetchMock.mockRejectedValue(new Error('Network failed with saved-key'))
  await expect(listOpenAICompatibleModels('openai')).rejects.toThrow('无法连接 OpenAI')
  fetchMock.mockResolvedValue(new Response('not json'))
  await expect(listOpenAICompatibleModels('openai')).rejects.toThrow('格式异常')
})

it('aborts slow requests and releases the timeout', async () => {
  vi.useFakeTimers()
  fetchMock.mockImplementation((_url, { signal }: RequestInit) => new Promise((_resolve, reject) => {
    signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  const assertion = expect(listOpenAICompatibleModels('openrouter')).rejects.toThrow('请求超时')
  await vi.advanceTimersByTimeAsync(MODEL_LIST_TIMEOUT_MS)
  await assertion
  expect(vi.getTimerCount()).toBe(0)
})
