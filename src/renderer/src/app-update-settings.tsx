import { useEffect, useRef, useState } from 'react'
import type { AppUpdateBridge, AppUpdateResult, AppVersionInfo } from '../../shared/app-update'

export function AppUpdateSettings({ bridge }: { bridge?: Partial<AppUpdateBridge> }) {
  const [info, setInfo] = useState<AppVersionInfo>()
  const [result, setResult] = useState<AppUpdateResult>()
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(false)
  const checking = useRef(false)
  useEffect(() => {
    mounted.current = true
    let cancelled = false
    if (bridge?.getAppVersion) {
      void bridge.getAppVersion().then(value => { if (!cancelled) setInfo(value) })
        .catch(() => { if (!cancelled) setError('无法读取当前版本，请重新打开此页面。') })
    }
    return () => { cancelled = true; mounted.current = false }
  }, [bridge])

  const check = async () => {
    if (!bridge?.checkAppUpdate || checking.current) return
    checking.current = true
    setBusy(true)
    setError('')
    setResult(undefined)
    try {
      const value = await bridge.checkAppUpdate()
      if (mounted.current) setResult(value)
    } catch {
      if (mounted.current) setError('检查更新失败，请重试。')
    } finally {
      checking.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const download = async () => {
    if (!bridge?.openAppDownload || opening) return
    setOpening(true)
    setError('')
    try {
      const value = await bridge.openAppDownload()
      if (mounted.current && !value.ok) setError(value.error)
    } catch {
      if (mounted.current) setError('无法打开下载页，请重试。')
    } finally { if (mounted.current) setOpening(false) }
  }
  return <section className="settingsPage appUpdateSettings" aria-label="关于与更新">
    <h2>EnglishAsk · 英问</h2>
    <p>当前版本：{info?.currentVersion ?? result?.currentVersion ?? '读取中…'}{info && !info.isPackaged ? '（开发版）' : ''}</p>
    <p>检查最新正式版，查看更新内容并前往下载。</p>
    <div className="appUpdateActions">
      <button type="button" disabled={!bridge?.checkAppUpdate || busy} onClick={() => void check()}>
        {busy ? '检查中…' : '检查更新'}
      </button>
      <button type="button" disabled={!bridge?.openAppDownload || opening} onClick={() => void download()}>
        {opening ? '打开中…' : '前往下载'}
      </button>
    </div>
    {!bridge?.getAppVersion ? <p role="alert">请在桌面应用中检查更新。</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {result?.status === 'error' ? <p role="alert">{result.error}</p> : null}
    {result && result.status !== 'error' ? <>
      <p role="status">{result.status === 'available' ? `发现新版本 v${result.latestVersion}` : `当前已是最新版本（最新正式版 v${result.latestVersion}）`}</p>
      <h3>更新说明 · v{result.latestVersion}</h3>
      <pre className="appReleaseNotes">{result.releaseNotes || '此版本暂未提供更新说明。'}</pre>
    </> : null}
  </section>
}
