import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { DEFAULT_MODEL_OPTIONS_BY_PROVIDER, MODEL_PROVIDER_OPTIONS, supportsDynamicModelListing,
  type ModelProvider, type ProviderModelsResult, type SettingsState } from '../../shared/ai'

interface Props {
  settings: SettingsState | null
  disabled: boolean
  label: string
  loadModels: (provider: ModelProvider) => Promise<ProviderModelsResult>
  onSelect: (provider: ModelProvider, model: string) => Promise<void>
}

export function ComposerModelMenu({ settings, disabled, label, loadModels, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<ModelProvider | null>(null)
  const [models, setModels] = useState<Partial<Record<ModelProvider, string[]>>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [position, setPosition] = useState({ left: 0, bottom: 0, width: 480, height: 320 })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const keyboardOpen = useRef(false)
  const loader = useRef(loadModels)
  loader.current = loadModels
  const configured = (id: ModelProvider) => settings?.providerSettings?.[id]
    ?? (settings?.modelProvider === id ? settings : undefined)
  const providers = MODEL_PROVIDER_OPTIONS.filter(option => configured(option.id)?.hasApiKey)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect()
      const margin = 8
      const width = Math.min(480, window.innerWidth - margin * 2)
      setPosition({ left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
        bottom: Math.max(margin, window.innerHeight - rect.top + margin), width,
        height: Math.min(320, Math.max(0, rect.top - margin * 2)) })
    }
    place()
    if (keyboardOpen.current) {
      menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
      keyboardOpen.current = false
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('pointerdown', outside)
    }
  }, [open])

  useEffect(() => {
    if (!open || !provider || !supportsDynamicModelListing(provider) || models[provider]) return
    let live = true
    setLoading(true)
    void loader.current(provider).then(result => {
      if (!live) return
      if (result.ok) setModels(current => ({ ...current, [provider]: [...new Set(result.data)] }))
      else setError('模型列表加载失败，已显示已保存和内置模型。')
    }).catch(() => { if (live) setError('模型列表加载失败，已显示已保存和内置模型。') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [open, provider, models])

  const activate = (id: ModelProvider) => {
    if (saving || provider === id || !configured(id)?.hasApiKey) return
    setError('')
    setLoading(false)
    setProvider(id)
  }
  const choices = provider ? [...new Set([
    configured(provider)?.modelName ?? '',
    ...(models[provider] ?? DEFAULT_MODEL_OPTIONS_BY_PROVIDER[provider])
  ])].filter(Boolean) : []

  async function choose(model: string) {
    if (!provider || saving || disabled) return
    if (settings?.modelProvider === provider && settings.modelName === model) { setOpen(false); return }
    setSaving(true)
    setError('')
    try { await onSelect(provider, model); setOpen(false); trigger.current?.focus() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '切换模型失败，请重试。') }
    finally { setSaving(false) }
  }

  return <>
    <button ref={trigger} type="button" className="composerModelTrigger" aria-label="选择聊天模型"
      aria-haspopup="menu" aria-expanded={open} disabled={disabled || !settings || saving || providers.length === 0}
      onClick={event => { keyboardOpen.current = event.detail === 0; setOpen(!open); setError(''); setProvider(null) }}
      onKeyDown={event => {
        if (event.key === 'Escape') setOpen(false)
        if (event.key === 'ArrowDown') { event.preventDefault(); keyboardOpen.current = true; setOpen(true) }
      }}>
      <span className="composerModelName">{label || '选择模型'}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} className="composerModelMenu" style={position}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus() }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const items = [...(event.target as HTMLElement).closest('[role="menu"]')!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
          const index = items.indexOf(event.target as HTMLButtonElement)
          items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
        }
        if (event.key === 'ArrowRight') menu.current?.querySelector<HTMLButtonElement>('.composerModelSubmenu button')?.focus()
        if (event.key === 'ArrowLeft') menu.current?.querySelector<HTMLButtonElement>('[data-active="true"]')?.focus()
      }}>
      <div role="menu" aria-label="模型服务商" className="composerProviderMenu">
        {providers.map(option => <button key={option.id} type="button" role="menuitem"
          disabled={saving} data-active={provider === option.id}
          aria-haspopup="menu" aria-expanded={provider === option.id}
          onMouseEnter={() => activate(option.id)} onFocus={() => activate(option.id)} onClick={() => activate(option.id)}>
          <span>{option.label}</span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>)}
      </div>
      {provider && <div role="menu" aria-label="服务商模型" className="composerModelSubmenu">
        {choices.map(model => <button type="button" role="menuitemradio" key={model}
          aria-checked={settings?.modelProvider === provider && settings.modelName === model}
          disabled={saving || disabled} onClick={() => void choose(model)}>
          <span>{model}</span>{settings?.modelProvider === provider && settings.modelName === model && <Check size={14} aria-hidden="true" />}
        </button>)}
        {loading && <p role="status">加载中…</p>}
        {error && <p className="composerModelError" role="alert">{error}</p>}
      </div>}
    </div>, document.body)}
  </>
}
