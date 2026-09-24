import { getEnvironmentProviderApiKey, getStoredProviderApiKey } from './settings'
import { filterTextModelIds } from './text-model-filter'
import {
  fetchNativeProviderJSON, isRecord, nativeProviderHeaders, NATIVE_PROVIDER_CONFIG,
  type NativeProvider
} from './native-provider-api'

export const NATIVE_MODEL_LIST_TIMEOUT_MS = 15_000
const MODEL_PAGE_SIZE = 100
const MAX_MODEL_PAGES = 50

export async function listNativeProviderModels(provider: NativeProvider, override?: string): Promise<string[]> {
  const apiKey = override?.trim() || await getStoredProviderApiKey(provider) ||
    getEnvironmentProviderApiKey(provider)?.trim()
  const { label, modelsURL } = NATIVE_PROVIDER_CONFIG[provider]
  if (!apiKey) throw new Error(`请先填写 ${label} API 密钥。`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NATIVE_MODEL_LIST_TIMEOUT_MS)
  const models = new Set<string>()
  const cursors = new Set<string>()
  let cursor = ''
  try {
    for (let page = 1; page <= MAX_MODEL_PAGES; page += 1) {
      const url = new URL(modelsURL)
      url.searchParams.set('limit', String(MODEL_PAGE_SIZE))
      if (cursor) url.searchParams.set('after_id', cursor)
      const body = await fetchNativeProviderJSON(provider, url.toString(), {
        headers: nativeProviderHeaders(provider, apiKey), signal: controller.signal
      })
      if (!isRecord(body)) throw new Error(`${label} 模型列表格式异常。`)
      const output = body
      const items = output.data
      if (!Array.isArray(items)) throw new Error(`${label} 模型列表格式异常。`)
      for (const item of items) {
        if (!isRecord(item)) continue
        const id = item.id
        if (typeof id === 'string' && id.trim() && !/\s/.test(id.trim()) && id.trim().length <= 160) {
          models.add(id.trim())
        }
      }
      if (typeof output.has_more !== 'boolean') throw new Error(`${label} 模型列表分页格式异常。`)
      const hasMore = output.has_more
      if (hasMore) {
        if (typeof output.last_id !== 'string' || !output.last_id || cursors.has(output.last_id)) {
          throw new Error(`${label} 模型列表分页格式异常。`)
        }
        cursor = output.last_id
        cursors.add(cursor)
      }
      if (!hasMore) {
        const textModels = filterTextModelIds([...models]).sort()
        if (!textModels.length) throw new Error(`${label} 未返回可用的文本模型。`)
        return textModels
      }
      if (!items.length) throw new Error(`${label} 模型列表分页为空，请重试。`)
    }
    throw new Error(`${label} 模型列表超过分页上限，请稍后重试。`)
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${label} 模型列表请求超时，请重试。`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
