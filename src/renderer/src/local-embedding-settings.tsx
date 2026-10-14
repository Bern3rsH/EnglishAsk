import { useEffect, useRef, useState } from 'react'
import { LOCAL_EMBEDDING_MODEL, type EmbeddingBridge, type EmbeddingResult, type EmbeddingStatus } from '../../shared/embedding'
const STATUS_POLL_MS = 500
export function LocalEmbeddingSettings({ bridge }: { bridge?: Partial<EmbeddingBridge> }) {
  const [status, setStatus] = useState<EmbeddingStatus>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const mounted = useRef(false)
  const available = Boolean(bridge?.getEmbeddingStatus && bridge.downloadEmbeddingModel && bridge.cancelEmbeddingDownload && bridge.setEmbeddingEnabled)
  const accept = (result: EmbeddingResult) => {
    if (!mounted.current) return
    if (result.ok) { setStatus(result.data); setError('') } else { setError(result.error) }
  }
  useEffect(() => {
    mounted.current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    const refresh = async () => {
      if (!bridge?.getEmbeddingStatus) return
      try { const result = await bridge.getEmbeddingStatus(); if (!cancelled) accept(result) }
      catch { if (!cancelled) setError('无法读取本地模型状态。') }
      if (!cancelled) timer = setTimeout(() => { void refresh() }, STATUS_POLL_MS)
    }
    void refresh()
    return () => { mounted.current = false; cancelled = true; clearTimeout(timer) }
  }, [bridge])
  const run = async (action: () => Promise<EmbeddingResult>) => {
    setBusy(true)
    try { accept(await action()) } catch { if (mounted.current) setError('本地模型操作失败，请重试。') }
    finally { if (mounted.current) setBusy(false) }
  }
  const downloading = status?.status === 'downloading'
  const checking = status?.status === 'checking'
  const ready = status?.status === 'ready'
  return <section aria-label="本地语义检索" className="localEmbeddingSettings">
    <h3>本地语义检索</h3>
    <p>{LOCAL_EMBEDDING_MODEL.name} · 639 MB · 2K 上下文</p>
    <p>下载后在本机检索笔记，无需 Ollama 或 Embedding API Key。回答模型仍使用你的模型设置。</p>
    {ready ? <label className="settingsCheckbox"><input type="checkbox" checked={status.enabled} disabled={busy}
      onChange={event => { void run(() => bridge!.setEmbeddingEnabled!(event.target.checked)) }} />启用语义 + 关键词检索</label>
      : <button type="button" disabled={!available || busy || checking}
        onClick={() => { void run(() => downloading ? bridge!.cancelEmbeddingDownload!() : bridge!.downloadEmbeddingModel!()) }}>
        {downloading ? '取消下载' : checking ? '校验模型中' : status?.status === 'error' ? '重新下载模型' : '下载模型'}</button>}
    {downloading ? <><progress aria-label="模型下载进度" value={status.downloadedBytes} max={status.totalBytes} />
      <p role="status">{Math.floor(status.downloadedBytes / status.totalBytes * 100)}% · {(status.downloadedBytes / 1_000_000).toFixed(1)} / 639 MB</p></> : null}
    {ready ? <p role="status">{status.enabled ? '模型已就绪' : '已关闭语义检索，使用关键词检索'}</p> : null}
    {error || status?.error ? <p role="alert">{error || status?.error}</p> : null}
  </section>
}
