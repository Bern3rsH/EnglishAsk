import { useEffect, useState } from 'react'
import { DEFAULT_MODEL_OPTIONS_BY_PROVIDER, MODEL_PROVIDER_OPTIONS, type ModelProvider, type SettingsState } from '../../shared/ai'

export function useAnkiModel() {
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [selectedProvider, setProvider] = useState<ModelProvider>('google-gemini')
  const [choices, setChoices] = useState<Partial<Record<ModelProvider, string>>>({})
  const [lists, setLists] = useState<Partial<Record<ModelProvider, string[]>>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setError(null)
    void (async () => {
      try {
        const result = await window.englishAsk?.getSettings()
        if (cancelled) return
        if (!result?.ok) throw new Error(result?.error || '无法读取模型设置。')
        setSettings(result.data)
        setProvider(result.data.modelProvider)
      } catch {
        if (!cancelled) setError('无法读取模型设置，请重试。')
      }
    })()
    return () => { cancelled = true }
  }, [attempt])
  const providers = MODEL_PROVIDER_OPTIONS.filter(({ id }) =>
    settings?.providerSettings?.[id]?.hasApiKey ?? (settings?.modelProvider === id && settings.hasApiKey))
  const provider = providers.find(({ id }) => id === selectedProvider)?.id ?? providers[0]?.id ?? selectedProvider
  const saved = settings?.providerSettings?.[provider]
  const hasKey = saved?.hasApiKey ?? (settings?.modelProvider === provider && settings.hasApiKey)
  const savedModel = saved?.modelName ?? (settings?.modelProvider === provider ? settings.modelName : '')
  const model = hasKey ? choices[provider] ?? (savedModel || DEFAULT_MODEL_OPTIONS_BY_PROVIDER[provider][0]) : ''
  const options = hasKey ? [...new Set([model, savedModel, ...(lists[provider] ?? DEFAULT_MODEL_OPTIONS_BY_PROVIDER[provider])].filter(Boolean))] : []
  useEffect(() => { setError(null) }, [provider])
  const refresh = async () => {
    if (loading || !hasKey) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.englishAsk?.listProviderModels({ modelProvider: provider })
      if (!result?.ok) throw new Error('无法刷新模型，请重试。')
      setLists(current => ({ ...current, [provider]: result.data }))
    } catch {
      setError('无法刷新模型，请重试。')
    } finally { setLoading(false) }
  }
  return { provider, providers, setProvider, model, options, hasKey, settings, loading, error, refresh,
    retry: () => setAttempt(value => value + 1),
    select: (value: string) => setChoices(current => ({ ...current, [provider]: value })) }
}
