export type NativeProvider = 'anthropic'
export const ANTHROPIC_API_VERSION = '2023-06-01'
export const NATIVE_PROVIDER_CONFIG = {
  anthropic: { label: 'Anthropic', modelsURL: 'https://api.anthropic.com/v1/models' }
} as const

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function nativeProviderHeaders(provider: NativeProvider, apiKey: string): Record<string, string> {
  return { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_API_VERSION }
}

export async function fetchNativeProviderJSON(
  provider: NativeProvider, url: string, init: RequestInit
): Promise<unknown> {
  init.signal?.throwIfAborted()
  const label = NATIVE_PROVIDER_CONFIG[provider].label
  let response: Response
  try {
    response = await fetch(url, { ...init, redirect: 'error' })
  } catch {
    if (init.signal?.aborted) throw init.signal.reason
    throw new Error(`无法连接 ${label}，请检查网络后重试。`)
  }
  if (!response.ok) {
    const detail = response.status === 401 || response.status === 403
      ? '请检查密钥、访问权限及地域'
      : response.status === 429 ? '请求过于频繁，请稍后重试' : '请稍后重试'
    // Provider error bodies can echo credentials; keep only the status.
    throw new Error(`${label} 请求失败（${response.status}）：${detail}。`)
  }
  try {
    return await response.json()
  } catch {
    if (init.signal?.aborted) throw init.signal.reason
    throw new Error(`${label} 返回了无效的 JSON。`)
  }
}
