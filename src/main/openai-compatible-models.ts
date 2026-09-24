import { getEnvironmentProviderApiKey, getStoredProviderApiKey } from './settings'
import { isTextModelId } from './text-model-filter'

type ListingProvider = 'openai' | 'openrouter'
export const MODEL_LIST_TIMEOUT_MS = 15_000
const PROVIDERS = {
  openai: { label: 'OpenAI', endpoint: 'https://api.openai.com/v1/models' },
  openrouter: { label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/models' }
} as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function extractModels(body: unknown, provider: ListingProvider): string[] {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    throw new Error(`${PROVIDERS[provider].label} 模型列表格式异常，请稍后重试。`)
  }
  const models = new Set<string>()
  for (const item of body.data) {
    if (!isRecord(item) || typeof item.id !== 'string') continue
    const id = item.id.trim()
    if (!id || /\s/.test(id) || id.length > 160) continue
    if (provider === 'openrouter' && isRecord(item.architecture) &&
        Array.isArray(item.architecture.output_modalities)) {
      if (!item.architecture.output_modalities.includes('text')) continue
      if (Array.isArray(item.architecture.input_modalities) &&
          !item.architecture.input_modalities.includes('text')) continue
    } else if (!isTextModelId(id) || /^(babbage|davinci|sora)(-|$)/.test(id)) {
      continue
    }
    models.add(id)
  }
  if (models.size === 0) {
    throw new Error(`${PROVIDERS[provider].label} 未返回可用的文本模型。`)
  }
  return [...models].sort()
}

export async function listOpenAICompatibleModels(
  provider: ListingProvider,
  apiKeyOverride?: string
): Promise<string[]> {
  const { label, endpoint } = PROVIDERS[provider]
  const apiKey = apiKeyOverride?.trim() ||
    (await getStoredProviderApiKey(provider)) || getEnvironmentProviderApiKey(provider)?.trim()
  if (!apiKey) throw new Error(`请先填写 ${label} API 密钥。`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS)
  let body: unknown
  try {
    let response: Response
    try {
      response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        redirect: 'error'
      })
    } catch {
      throw new Error(controller.signal.aborted
        ? `${label} 模型列表请求超时，请重试。`
        : `无法连接 ${label}，请检查网络后重试。`)
    }
    // Do not forward provider error bodies: they may echo credentials.
    if (!response.ok) {
      const reason = response.status === 401 || response.status === 403
        ? '请检查 API 密钥及访问权限'
        : response.status === 429 ? '请求过于频繁，请稍后重试' : '请稍后重试'
      throw new Error(`${label} 模型列表请求失败（${response.status}）：${reason}。`)
    }
    try {
      body = await response.json()
    } catch {
      throw new Error(controller.signal.aborted
        ? `${label} 模型列表请求超时，请重试。`
        : `${label} 模型列表格式异常，请稍后重试。`)
    }
  } finally {
    clearTimeout(timer)
  }
  return extractModels(body, provider)
}
