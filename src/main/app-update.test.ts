import { describe, expect, it, vi } from 'vitest'
import { APP_DOWNLOAD_URL, LATEST_RELEASE_API, createAppUpdateChecker, isNewerStableVersion, openAppDownload, UPDATE_TIMEOUT_MS } from './app-update'
const release = (overrides = {}) => ({ tag_name: 'v0.2.0', draft: false, prerelease: false, body: '### 改进\n手写更新内容', ...overrides })
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })

describe('manual update check', () => {
  it.each([
    ['0.10.0', '0.9.9', true], ['1.0.0', '0.99.99', true], ['0.1.2', '0.1.2', false],
    ['0.1.2', '0.2.0', false], ['1.0.0', '1.0.0-beta.1', true], ['1.0.0', '1.0.0+build', false]
  ])('compares %s with %s', (latest, current, expected) => {
    expect(isNewerStableVersion(latest, current)).toBe(expected)
  })
  it('fetches only the known endpoint and returns handwritten notes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(release()))
    const result = await createAppUpdateChecker(() => '0.1.2', fetcher)()
    expect(result).toEqual({ status: 'available', currentVersion: '0.1.2', latestVersion: '0.2.0', releaseNotes: '### 改进\n手写更新内容' })
    expect(fetcher).toHaveBeenCalledWith(LATEST_RELEASE_API, expect.objectContaining({ signal: expect.any(AbortSignal), redirect: 'error' }))
  })
  it('deduplicates in-flight checks and permits a fresh check after completion', async () => {
    let finish!: (response: Response) => void
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValue(response(release({ body: null })))
    const check = createAppUpdateChecker(() => '0.3.0', fetcher)
    const first = check()
    expect(check()).toBe(first)
    expect(fetcher).toHaveBeenCalledTimes(1)
    finish(response(release()))
    expect((await first).status).toBe('current')
    expect(await check()).toMatchObject({ status: 'current', releaseNotes: '' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it.each([404, 403, 429, 500])('reports HTTP %s as failure, never up to date', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }))
    expect(await createAppUpdateChecker(() => '0.1.2', fetcher)()).toMatchObject({ status: 'error' })
  })
  it.each([
    { tag_name: 'nonsense' }, { tag_name: 'v0.2.0-beta.1' }, { draft: true }, { prerelease: true }, { body: 123 }
  ])('rejects invalid release metadata %j', async overrides => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(release(overrides)))
    expect((await createAppUpdateChecker(() => '0.1.2', fetcher)()).status).toBe('error')
  })
  it('recovers after network failure without exposing raw network errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('internal details'))
      .mockResolvedValue(response(release()))
    const check = createAppUpdateChecker(() => '0.1.2', fetcher)
    const failure = await check()
    expect(failure.status).toBe('error')
    expect(JSON.stringify(failure)).not.toContain('internal details')
    expect((await check()).status).toBe('available')
  })
  it('uses a bounded abort signal and handles a timeout', async () => {
    const signal = AbortSignal.abort(new DOMException('timeout', 'TimeoutError'))
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal)
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_, options) => {
        options!.signal!.throwIfAborted()
        return response(release())
      })
      expect((await createAppUpdateChecker(() => '0.1.2', fetcher)()).status).toBe('error')
      expect(timeout).toHaveBeenCalledWith(UPDATE_TIMEOUT_MS)
    } finally { timeout.mockRestore() }
  })
  it('opens only the fixed download page and handles browser failures', async () => {
    const open = vi.fn().mockResolvedValue(undefined)
    expect(await openAppDownload(open)).toEqual({ ok: true })
    expect(open).toHaveBeenCalledWith(APP_DOWNLOAD_URL)
    open.mockRejectedValue(new Error('browser unavailable'))
    expect(await openAppDownload(open)).toMatchObject({ ok: false })
  })
})
