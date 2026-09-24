import { pathToFileURL } from 'node:url'

export const ENDPOINT = 'https://ai-gateway.vercel.sh/v1/evaluate'
const MODEL = 'typesafe-ai/jev'
const REQUEST_TIMEOUT_MS = 30_000

// Standalone trial: no application history or user content is sent.
export async function tryJev({ apiKey, fetchImpl = fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('请在 .env 中设置 AI_GATEWAY_API_KEY。')
  }
  const startedAt = performance.now()
  let response
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL,
        state: 'Please translate this sentence into Chinese.',
        questions: {
          translation: {
            type: 'boolean',
            instructions: 'Does the user explicitly request a translation?'
          }
        }
      })
    })
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('Jev 请求超时或已取消。')
    }
    throw new Error('无法连接 Vercel AI Gateway，请检查网络。')
  }
  if (!response.ok) {
    // Do not log response bodies: upstream errors can echo request credentials.
    const hints = {
      401: '请检查 Gateway API Key。',
      403: '请检查账户或模型访问权限。',
      402: '请检查 Gateway 余额。',
      429: '请求受限，请稍后重试。'
    }
    throw new Error(`Gateway HTTP ${response.status}。${hints[response.status] ?? '服务返回错误。'}`)
  }
  let result
  try {
    result = await response.json()
  } catch {
    throw new Error('Gateway 返回的内容不是有效 JSON。')
  }
  const answer = result?.answers?.translation
  if (answer?.type !== 'boolean' || !Number.isFinite(answer.probability) ||
      answer.probability < 0 || answer.probability > 1 ||
      typeof result.model !== 'string' || !result.model.trim()) {
    throw new Error('Gateway 返回的模型或判断结果格式无效。')
  }
  return {
    model: result.model,
    translationProbability: answer.probability,
    elapsedMs: Math.round(performance.now() - startedAt)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await tryJev({ apiKey: process.env.AI_GATEWAY_API_KEY }), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
