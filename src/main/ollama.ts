import { OLLAMA_BASE_URL } from '../shared/ai'
import { normalizeOllamaBaseUrl } from '../shared/ollama-url'
import { isRecord } from './native-provider-api'
import type { GenerateProviderTextOptions } from './provider-adapters'
import { filterTextModelIds } from './text-model-filter'

const MODEL_LIST_TIMEOUT_MS = 15_000
const GENERATION_TIMEOUT_MS = 180_000

async function request(baseUrl: string, path: string, signal: AbortSignal, body?: unknown): Promise<Record<string, unknown>> {
  signal.throwIfAborted()
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error', signal,
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      })
    })
  } catch {
    signal.throwIfAborted()
    throw new Error(`无法连接 Ollama，请确认服务地址和网络连接（${baseUrl}）。`)
  }
  if (!response.ok) throw new Error(response.status === 404
    ? 'Ollama 模型或接口不存在，请刷新模型列表并确认模型已安装。'
    : `Ollama 请求失败（HTTP ${response.status}）。`)
  let data: unknown
  try { data = await response.json() } catch {
    signal.throwIfAborted()
    throw new Error('Ollama 返回了无效 JSON。')
  }
  if (!isRecord(data) || data.error) throw new Error('Ollama 返回了无效响应。')
  return data
}

export async function listOllamaModels(address = OLLAMA_BASE_URL): Promise<string[]> {
  const baseUrl = normalizeOllamaBaseUrl(address)
  const signal = AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS)
  const data = await request(baseUrl, 'tags', signal)
  if (!Array.isArray(data.models)) throw new Error('Ollama 模型列表格式无效。')
  const names = filterTextModelIds([...new Set(data.models.flatMap(model =>
    isRecord(model) && typeof model.name === 'string' && model.name.trim()
      ? [model.name.trim()] : []))])
  const models: string[] = []
  for (const name of names) {
    const details = await request(baseUrl, 'show', signal, { model: name })
    if (!Array.isArray(details.capabilities)) throw new Error('无法识别 Ollama 模型能力，请更新 Ollama 后重试。')
    if (details.capabilities.includes('completion') &&
      !details.capabilities.some(capability => ['vision', 'embedding', 'audio', 'image'].includes(String(capability)))) {
      models.push(name)
    }
  }
  return models.sort()
}

export async function generateOllamaText(options: GenerateProviderTextOptions, address = OLLAMA_BASE_URL): Promise<string> {
  const baseUrl = normalizeOllamaBaseUrl(address)
  if (!options.modelName.trim()) throw new Error('请先在设置中刷新并选择 Ollama 模型。')
  const timeout = AbortSignal.timeout(GENERATION_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const data = await request(baseUrl, 'chat', signal, {
    model: options.modelName, stream: false,
    messages: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.prompt }
    ],
    ...(options.responseFormat === 'json' ? { format: 'json' } : {})
  })
  if (data.done !== true || data.done_reason === 'length') throw new Error('Ollama 回答未完成，请缩小问题范围后重试。')
  const answer = isRecord(data.message) && typeof data.message.content === 'string'
    ? data.message.content.trim() : ''
  if (!answer) throw new Error('Ollama 未返回回答内容。')
  return answer
}
