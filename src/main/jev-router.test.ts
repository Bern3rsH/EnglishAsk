import { afterEach, expect, it, vi } from 'vitest'
import { classifyWithJev, compareRouterLabels, JEV_ROUTER_ENDPOINT, JEV_ROUTER_FIELDS,
  JEV_ROUTER_MODEL, JEV_ROUTER_QUESTIONS, JEV_ROUTER_TIMEOUT_MS } from './jev-router'
import { ROUTER_INPUT_TYPES, ROUTER_INTENTS, ROUTER_RESPONSE_MODES, ROUTER_STRUCTURE_TYPES } from '../shared/router'

const request = { requestId: 'trial', question: '它怎么读？', history: [
  { id: 'previous', role: 'user' as const, content: 'resilient', createdAt: '2026-09-24' }
] }
const labels = { inputType: 'word', structureType: 'single_word', intent: 'ask_pronunciation', responseMode: 'card' } as const
const responseData = () => ({ model: JEV_ROUTER_MODEL, usage: { cost: 0.0001 },
  answers: Object.fromEntries(JEV_ROUTER_FIELDS.map(field => [field, {
    type: 'choice', choice: labels[field], confidence: 0.9,
    probabilities: Object.fromEntries(Object.keys(JEV_ROUTER_QUESTIONS[field].criteria)
      .map(option => [option, option === labels[field] ? 1 : 0]))
  }])) })
afterEach(() => vi.restoreAllMocks())

it('keeps every categorical option aligned with the existing Router', () => {
  for (const [field, expected] of [
    ['inputType', ROUTER_INPUT_TYPES], ['structureType', ROUTER_STRUCTURE_TYPES],
    ['intent', ROUTER_INTENTS], ['responseMode', ROUTER_RESPONSE_MODES]
  ] as const) expect(Object.keys(JEV_ROUTER_QUESTIONS[field].criteria)).toEqual([...expected])
})

it('sends the same question/history, never credentials in state, and returns labels only', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(responseData()))
  const result = await classifyWithJev({ apiKey: ' secret ', request, fetchImpl })
  const [url, options] = fetchImpl.mock.calls[0]
  expect(url).toBe(JEV_ROUTER_ENDPOINT)
  expect(options).toMatchObject({ method: 'POST', redirect: 'error',
    headers: { Authorization: 'Bearer secret' } })
  const body = JSON.parse(options!.body as string)
  expect(body.state).toBe('User: resilient\nUser: 它怎么读？')
  expect(body.model).toBe(JEV_ROUTER_MODEL)
  expect(body.questions).toEqual(JEV_ROUTER_QUESTIONS)
  expect(body.state).not.toContain('secret')
  expect(result.labels).toEqual(labels)
  expect(result).not.toHaveProperty('targets')
  expect(result.cost).toBe(0.0001)
  expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
})

it('rejects missing credentials and pre-cancelled requests before sending', async () => {
  const fetchImpl = vi.fn<typeof fetch>()
  await expect(classifyWithJev({ apiKey: ' ', request, fetchImpl })).rejects.toThrow('API key')
  await expect(classifyWithJev({ apiKey: 'secret', request, fetchImpl,
    signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetchImpl).not.toHaveBeenCalled()
})

it.each([401, 402, 403, 429, 500])('reports HTTP %s without leaking or retrying', async status => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret prompt echo', { status }))
  await expect(classifyWithJev({ apiKey: 'secret', request, fetchImpl })).rejects.toThrow(`HTTP ${status}`)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})

it.each(['choice', 'confidence', 'probabilities', 'missing', 'type'])('rejects malformed %s', async field => {
  const data = responseData()
  Object.assign(data.answers.inputType, field === 'missing' ? {} : {
    [field]: { choice: 'invented', confidence: 1.1, probabilities: {}, type: 'noul' }[field]
  })
  if (field === 'missing') delete data.answers.inputType
  await expect(classifyWithJev({ apiKey: 'secret', request,
    fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json(data)) })).rejects.toThrow('invalid inputType')
})

it('redacts transport and malformed JSON errors', async () => {
  for (const fetchImpl of [vi.fn<typeof fetch>().mockRejectedValue(new Error('secret')),
    vi.fn<typeof fetch>().mockResolvedValue(new Response('secret'))]) {
    await expect(classifyWithJev({ apiKey: 'secret', request, fetchImpl }))
      .rejects.toThrow('Jev routing request failed or returned invalid JSON.')
  }
})

it('propagates cancellation during a request', async () => {
  const controller = new AbortController()
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    controller.abort()
    options!.signal!.throwIfAborted()
    return Response.json(responseData())
  })
  await expect(classifyWithJev({ apiKey: 'secret', request, signal: controller.signal, fetchImpl }))
    .rejects.toMatchObject({ name: 'AbortError' })
})

it('bounds the request time without leaking the timeout cause', async () => {
  const controller = new AbortController()
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
    controller.abort()
    throw new Error('secret')
  })
  await expect(classifyWithJev({ apiKey: 'secret', request, fetchImpl })).rejects.toThrow('timed out')
  expect(timeout).toHaveBeenCalledWith(JEV_ROUTER_TIMEOUT_MS)
})

it('reports disagreements without modifying either classification', () => {
  const baseline = Object.freeze({ ...labels, intent: 'explain_meaning' as const })
  const candidate = Object.freeze(labels)
  expect(compareRouterLabels(baseline, candidate)).toEqual(['intent'])
  expect(compareRouterLabels(candidate, candidate)).toEqual([])
  expect(baseline.intent).toBe('explain_meaning')
})


it.each([
  ['openrouter', 'https://openrouter.ai/api/alpha/decisions', 'typesafe/jev-1.13'],
  ['vercel', 'https://ai-gateway.vercel.sh/typesafe/v1/systemone', 'typesafe-ai/jev'],
  ['typesafe', 'https://api.typesafe.ai/v1/systemone', 'jev-latest'],
  ['cloudflare', 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run', 'typesafe/jev']
] as const)('uses the documented %s request contract', async (channel, endpoint, model) => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(responseData()))
  const result = await classifyWithJev({ channel, accountId: '0123456789abcdef0123456789abcdef', apiKey: 'channel-key', request, fetchImpl })
  const [url, options] = fetchImpl.mock.calls[0]
  expect(url).toBe(endpoint)
  expect(options!.headers).toMatchObject({ Authorization: 'Bearer channel-key' })
  const body = JSON.parse(options!.body as string)
  expect(body.model).toBe(model)
  expect(channel === 'cloudflare' ? body.input.questions : body.questions).toEqual(JEV_ROUTER_QUESTIONS)
  expect(result.labels).toEqual(labels)
  expect(result.confidence.inputType).toBe(0.9)
})

it('unwraps Cloudflare REST results and rejects failure envelopes without exposing errors', async () => {
  const options = { channel: 'cloudflare' as const, accountId: '0123456789abcdef0123456789abcdef', apiKey: 'secret', request }
  expect((await classifyWithJev({ ...options, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, result: responseData() })) })).labels).toEqual(labels)
  await expect(classifyWithJev({ ...options, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: false, errors: ['secret'] })) })).rejects.toThrow('Jev Cloudflare request failed.')
  for (const accountId of [undefined, '../other', 'short']) {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(classifyWithJev({ ...options, accountId, fetchImpl })).rejects.toThrow('Account ID')
    expect(fetchImpl).not.toHaveBeenCalled()
  }
})
