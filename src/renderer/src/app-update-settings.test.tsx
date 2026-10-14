// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppUpdateSettings } from './app-update-settings'
import type { AppUpdateBridge, AppUpdateResult } from '../../shared/app-update'
let host: HTMLDivElement
let root: Root
let bridge: AppUpdateBridge
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  bridge = {
    getAppVersion: vi.fn().mockResolvedValue({ currentVersion: '0.1.2', isPackaged: true }),
    checkAppUpdate: vi.fn().mockResolvedValue({ status: 'available', currentVersion: '0.1.2', latestVersion: '0.2.0', releaseNotes: '<script>alert(1)</script>\n手写说明' }),
    openAppDownload: vi.fn().mockResolvedValue({ ok: true })
  }
})
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const button = (label: string) => [...host.querySelectorAll('button')].find(item => item.textContent === label)!
const render = async () => { await act(() => root.render(<AppUpdateSettings bridge={bridge} />)) }
it('shows current version without automatically fetching, checks manually and opens download', async () => {
  await render()
  expect(host.textContent).toContain('当前版本：0.1.2')
  expect(bridge.checkAppUpdate).not.toHaveBeenCalled()
  await act(() => button('检查更新').click())
  expect(host.textContent).toContain('发现新版本 v0.2.0')
  expect(host.querySelector('pre')?.textContent).toContain('<script>alert(1)</script>')
  expect(host.querySelector('script')).toBeNull()
  await act(() => button('前往下载').click())
  expect(bridge.openAppDownload).toHaveBeenCalledOnce()
})
it('prevents duplicate clicks while pending and shows the current release', async () => {
  let finish!: (result: AppUpdateResult) => void
  vi.mocked(bridge.checkAppUpdate).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await render()
  await act(() => { button('检查更新').click(); button('检查更新').click() })
  expect(button('检查中…').disabled).toBe(true)
  expect(bridge.checkAppUpdate).toHaveBeenCalledOnce()
  await act(() => finish({ status: 'current', currentVersion: '0.1.2', latestVersion: '0.1.2', releaseNotes: '' }))
  expect(host.textContent).toContain('当前已是最新版本')
  expect(host.textContent).toContain('暂未提供更新说明')
})
it('keeps download available after errors and permits retry', async () => {
  vi.mocked(bridge.checkAppUpdate).mockRejectedValueOnce(new Error('offline'))
  await render()
  await act(() => button('检查更新').click())
  expect(host.textContent).toContain('检查更新失败')
  expect(button('前往下载').disabled).toBe(false)
  await act(() => button('检查更新').click())
  expect(host.textContent).toContain('发现新版本')
  vi.mocked(bridge.openAppDownload).mockResolvedValue({ ok: false, error: '无法打开浏览器' })
  await act(() => button('前往下载').click())
  expect(host.textContent).toContain('无法打开浏览器')
})
it('shows server failure instead of claiming the app is current', async () => {
  vi.mocked(bridge.checkAppUpdate).mockResolvedValue({ status: 'error', currentVersion: '0.1.2', error: '网络不可用' })
  await render(); await act(() => button('检查更新').click())
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('网络不可用')
  expect(host.textContent).not.toContain('已是最新版本')
})
it('disables unavailable bridge actions', async () => {
  await act(() => root.render(<AppUpdateSettings />))
  expect(button('检查更新').disabled).toBe(true)
  expect(button('前往下载').disabled).toBe(true)
})
