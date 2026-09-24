import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { listNativeProviderModels, NATIVE_MODEL_LIST_TIMEOUT_MS } from './native-provider-models'
import { getEnvironmentProviderApiKey, getStoredProviderApiKey } from './settings'

vi.mock('./settings', () => ({ getEnvironmentProviderApiKey: vi.fn(), getStoredProviderApiKey: vi.fn() }))
const fetchMock = vi.fn()
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getStoredProviderApiKey).mockResolvedValue('saved-key')
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('uses unsaved Anthropic credentials', async () => {
  fetchMock.mockResolvedValue(response({ data: [{ id: 'claude-sonnet-5' }], has_more: false }))
  expect(await listNativeProviderModels('anthropic', ' new-key ')).toEqual(['claude-sonnet-5'])
  expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBe('new-key')
  expect(getStoredProviderApiKey).not.toHaveBeenCalled()
})

it('loads all Anthropic cursors using version and key headers', async () => {
  fetchMock.mockResolvedValueOnce(response({ data: [{ id: 'claude-sonnet-5' }], has_more: true, last_id: 'cursor-one' }))
    .mockResolvedValueOnce(response({ data: [{ id: 'claude-haiku-4-5-20251001' }], has_more: false }))
  expect(await listNativeProviderModels('anthropic')).toEqual(['claude-haiku-4-5-20251001', 'claude-sonnet-5'])
  expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'x-api-key': 'saved-key', 'anthropic-version': '2023-06-01' })
  expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('after_id')).toBe('cursor-one')
})

it.each(['anthropic'] as const)('requires %s credentials and resolves its environment fallback', async provider => {
  vi.mocked(getStoredProviderApiKey).mockResolvedValue(undefined)
  await expect(listNativeProviderModels(provider)).rejects.toThrow('请先填写')
  expect(fetchMock).not.toHaveBeenCalled()
  vi.mocked(getEnvironmentProviderApiKey).mockReturnValue('env-key')
  fetchMock.mockResolvedValue(response({ data: [{ id: 'claude-sonnet-5' }], has_more: false }))
  await listNativeProviderModels(provider)
  expect(getEnvironmentProviderApiKey).toHaveBeenLastCalledWith(provider)
  expect(JSON.stringify(fetchMock.mock.calls[0][1].headers)).toContain('env-key')
})

it.each([401, 403, 429, 500])('sanitizes HTTP %s errors', async status => {
  fetchMock.mockResolvedValue(response({ error: { message: 'saved-key' } }, status))
  const error: unknown = await listNativeProviderModels('anthropic').catch(error => error)
  expect(String(error)).toContain(String(status))
  expect(String(error)).not.toContain('saved-key')
})

it.each([null, {}, { data: [] }, { data: [], has_more: false }, { data: [], has_more: true, last_id: 'x' }])('rejects malformed or empty Anthropic pages: %j', async body => {
  fetchMock.mockResolvedValue(response(body))
  await expect(listNativeProviderModels('anthropic')).rejects.toThrow()
})

it('rejects repeated cursors', async () => {
  fetchMock.mockImplementation(async () => response({ data: [{ id: 'claude-sonnet-5' }], has_more: true, last_id: 'same' }))
  await expect(listNativeProviderModels('anthropic')).rejects.toThrow('分页格式异常')
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('aborts a slow list and clears the timeout', async () => {
  vi.useFakeTimers()
  fetchMock.mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
  }))
  const check = expect(listNativeProviderModels('anthropic')).rejects.toThrow('请求超时')
  await vi.advanceTimersByTimeAsync(NATIVE_MODEL_LIST_TIMEOUT_MS)
  await check
  expect(vi.getTimerCount()).toBe(0)
})
