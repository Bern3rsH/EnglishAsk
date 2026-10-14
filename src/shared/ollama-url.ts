import { OLLAMA_BASE_URL } from './ai'

const MAX_URL_LENGTH = 2048

export function normalizeOllamaBaseUrl(value: unknown = OLLAMA_BASE_URL): string {
  const message = 'Ollama 服务地址必须是 HTTP/HTTPS 根地址，不能包含用户名、密码、路径、查询参数或片段。'
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_URL_LENGTH) {
    throw new Error(message)
  }
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error(message) }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || /[?#\\\r\n\t]/.test(value)) {
    throw new Error(message)
  }
  return url.origin
}
