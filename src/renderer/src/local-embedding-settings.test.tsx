// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { LocalEmbeddingSettings } from './local-embedding-settings'
import type { EmbeddingBridge, EmbeddingStatus } from '../../shared/embedding'
let cleanup: (() => Promise<void>) | undefined
afterEach(async () => { await cleanup?.(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('downloads, shows progress, cancels and enables without a key input', async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let status: EmbeddingStatus = { status: 'missing', downloadedBytes: 0, totalBytes: 639150592, enabled: true }
  const result = () => Promise.resolve({ ok: true as const, data: { ...status } })
  const bridge: EmbeddingBridge = {
    getEmbeddingStatus: vi.fn(result),
    downloadEmbeddingModel: vi.fn(() => { status.status = 'downloading'; status.downloadedBytes = 1000000; return result() }),
    cancelEmbeddingDownload: vi.fn(() => { status.status = 'missing'; return result() }),
    setEmbeddingEnabled: vi.fn(enabled => { status.enabled = enabled; return result() })
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  cleanup = async () => { await act(() => root.unmount()); host.remove() }
  await act(() => root.render(<LocalEmbeddingSettings bridge={bridge} />))
  expect(host.querySelector('input')).toBeNull()
  await act(() => host.querySelector('button')!.click())
  expect(bridge.downloadEmbeddingModel).toHaveBeenCalledOnce()
  expect(host.querySelector('progress')!.value).toBe(1000000)
  await act(() => host.querySelector('button')!.click())
  expect(bridge.cancelEmbeddingDownload).toHaveBeenCalledOnce()
  status.status = 'ready'; await act(() => vi.advanceTimersByTimeAsync(500))
  await act(() => host.querySelector('input')!.click())
  expect(bridge.setEmbeddingEnabled).toHaveBeenCalledWith(false)
  expect(host.textContent).toContain('已关闭语义检索')
})
