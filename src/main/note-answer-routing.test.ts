import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { decideNoteAnswerRoute, parseNoteAnswerRoute } from './note-answer-routing'
import { generateProviderText } from './provider-adapters'
import { getJevRoutingConfiguration } from './jev-routing-config'
import { decideNotesWithJev } from './jev-note-routing'

vi.mock('./provider-adapters', () => ({ generateProviderText: vi.fn() }))
vi.mock('./jev-routing-config', () => ({ getJevRoutingConfiguration: vi.fn() }))
vi.mock('./jev-note-routing', () => ({ decideNotesWithJev: vi.fn() }))
const request = { requestId: 'route', question: '我的笔记里有哪些例句？', history: [] }
const provider = { apiKey: 'test', modelProvider: 'deepseek' as const, modelName: 'test' }
beforeEach(() => vi.mocked(getJevRoutingConfiguration).mockResolvedValue(undefined))
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers() })

it('accepts confident Jev standard decisions without calling the answer model', async () => {
  const configuration = { channel: 'vercel' as const, apiKey: 'dedicated-key' }
  vi.mocked(getJevRoutingConfiguration).mockResolvedValue(configuration)
  vi.mocked(decideNotesWithJev).mockResolvedValue({ route: 'standard', queryMode: 'direct' })
  const result = await decideNoteAnswerRoute(request, provider)
  expect(result).toMatchObject({ route: 'standard', query: '', routing: { source: 'jev', channel: 'vercel' } })
  expect(decideNotesWithJev).toHaveBeenCalledWith(request, configuration, undefined)
  expect(generateProviderText).not.toHaveBeenCalled()
})

it('uses a direct Jev Notes query without a second classification or completion call', async () => {
  vi.mocked(getJevRoutingConfiguration).mockResolvedValue({ channel: 'typesafe', apiKey: 'dedicated-key' })
  vi.mocked(decideNotesWithJev).mockResolvedValue({ route: 'notes', queryMode: 'direct' })
  const result = await decideNoteAnswerRoute(request, provider)
  expect(result).toMatchObject({ route: 'notes', query: request.question, routing: { source: 'jev' } })
  expect(generateProviderText).not.toHaveBeenCalled()
})

it('uses the answer model only to resolve contextual queries after a Jev Notes decision', async () => {
  vi.mocked(getJevRoutingConfiguration).mockResolvedValue({ channel: 'openrouter', apiKey: 'dedicated-key' })
  vi.mocked(decideNotesWithJev).mockResolvedValue({ route: 'notes', queryMode: 'contextual' })
  vi.mocked(generateProviderText).mockResolvedValue('{"route":"notes","query":"我的笔记里draw attention to的例句"}')
  const result = await decideNoteAnswerRoute({ ...request, question: '它的例句呢？' }, provider)
  expect(result.routing).toMatchObject({ source: 'jev', queryCompletionCalled: true })
  expect(result.query).toContain('draw attention to')
  expect(vi.mocked(generateProviderText).mock.calls[0][0].systemPrompt).toContain('Return route notes only')
})

it('rejects query completion that contradicts an accepted Notes decision', async () => {
  vi.mocked(getJevRoutingConfiguration).mockResolvedValue({ channel: 'openrouter', apiKey: 'dedicated-key' })
  vi.mocked(decideNotesWithJev).mockResolvedValue({ route: 'notes', queryMode: 'contextual' })
  vi.mocked(generateProviderText).mockResolvedValue('{"route":"standard","query":""}')
  await expect(decideNoteAnswerRoute(request, provider)).rejects.toThrow('无法判断')
})

it('falls back to the existing answer-model decision on uncertain/failed Jev', async () => {
  vi.mocked(getJevRoutingConfiguration).mockResolvedValue({ channel: 'openrouter', apiKey: 'dedicated-key' })
  vi.mocked(decideNotesWithJev).mockRejectedValue(new Error('uncertain or unavailable'))
  vi.mocked(generateProviderText).mockResolvedValue('{"route":"notes","query":"我的笔记中的例句"}')
  expect(await decideNoteAnswerRoute(request, provider)).toMatchObject({ route: 'notes', routing: { source: 'jev-fallback' } })
  expect(generateProviderText).toHaveBeenCalledOnce()
})

it('uses the answer model when Jev settings cannot be read and does not leak the settings error', async () => {
  vi.mocked(getJevRoutingConfiguration).mockRejectedValue(new Error('secret path'))
  vi.mocked(generateProviderText).mockResolvedValue('{"route":"standard","query":""}')
  expect(await decideNoteAnswerRoute(request, provider)).toMatchObject({ route: 'standard', routing: { source: 'answer-model' } })
})

it('does not fall back after Jev cancellation', async () => {
  const controller = new AbortController()
  vi.mocked(getJevRoutingConfiguration).mockResolvedValue({ channel: 'openrouter', apiKey: 'dedicated-key' })
  vi.mocked(decideNotesWithJev).mockImplementationOnce(async () => { controller.abort(); throw new Error('aborted') })
  await expect(decideNoteAnswerRoute(request, { ...provider, signal: controller.signal })).rejects.toThrow()
  expect(generateProviderText).not.toHaveBeenCalled()
})

it('validates the complete routing contract and bounds query/output', () => {
  expect(parseNoteAnswerRoute('{"route":"standard","query":""}')).toEqual({ route: 'standard', query: '' })
  expect(parseNoteAnswerRoute('{"route":"notes","query":"  draw attention to的例句  "}'))
    .toEqual({ route: 'notes', query: 'draw attention to的例句' })
  for (const value of [null, [], {}, { route: 'auto', query: '' }, { route: 'notes', query: ' ' },
    { route: 'standard', query: 'used to' }, { route: 'notes', query: 'a'.repeat(2001) },
    { route: 'notes', query: '例句', extra: true }, { route: 'notes', query: 1 }]) {
    expect(() => parseNoteAnswerRoute(JSON.stringify(value))).toThrow('无法判断')
  }
  expect(() => parseNoteAnswerRoute('```json\n{}\n```')).toThrow('无法判断')
  expect(() => parseNoteAnswerRoute('a'.repeat(3001))).toThrow('无法判断')
})

it('uses bounded recent conversation to resolve a Notes follow-up without reading Notes', async () => {
  vi.mocked(generateProviderText).mockResolvedValue('{"route":"notes","query":"我的笔记里 draw attention to 的例句"}')
  const history = Array.from({ length: 8 }, (_, i) => ({ id: String(i), role: 'user' as const,
    content: `${i}:`.padEnd(2000, 'a'), createdAt: '2026-10-11' }))
  const result = await decideNoteAnswerRoute({ ...request, question: '它的例句呢？', history }, provider)
  expect(result.route).toBe('notes')
  const call = vi.mocked(generateProviderText).mock.calls[0][0]
  const prompt = JSON.parse(call.prompt)
  expect(prompt.question).toBe('它的例句呢？')
  expect(prompt.history).toHaveLength(4)
  expect(prompt.history[0].content.startsWith('4:')).toBe(true)
  expect(prompt.history.map((entry: { content: string }) => entry.content).join('').length).toBe(8000)
  expect(call).toMatchObject({ purpose: 'routing', responseFormat: 'json', modelName: 'test' })
  expect(call.prompt).not.toContain(provider.apiKey + '"')
})

it('surfaces malformed responses and provider failures without leaking provider details', async () => {
  for (const reply of ['{}', 'not JSON']) {
    vi.mocked(generateProviderText).mockResolvedValueOnce(reply)
    await expect(decideNoteAnswerRoute(request, provider)).rejects.toThrow('无法判断')
  }
  vi.mocked(generateProviderText).mockRejectedValueOnce(new Error('SECRET provider details'))
  await expect(decideNoteAnswerRoute(request, provider)).rejects.toThrow('无法判断')
})

it('does not call the provider when cancelled and propagates cancellation during routing', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(decideNoteAnswerRoute(request, { ...provider, signal: controller.signal })).rejects.toThrow()
  expect(generateProviderText).not.toHaveBeenCalled()
  const running = new AbortController()
  vi.mocked(generateProviderText).mockImplementationOnce(async () => { running.abort(); return '{"route":"standard","query":""}' })
  await expect(decideNoteAnswerRoute(request, { ...provider, signal: running.signal })).rejects.toThrow()
})

it('reports routing timeout separately', async () => {
  const timeout = new AbortController()
  const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
  vi.mocked(generateProviderText).mockImplementationOnce(async () => {
    timeout.abort(new DOMException('timeout', 'TimeoutError'))
    throw new Error('provider interrupted')
  })
  try {
    await expect(decideNoteAnswerRoute(request, provider)).rejects.toThrow('笔记自动判断超时')
    expect(generateProviderText).toHaveBeenCalledOnce()
  } finally { spy.mockRestore() }
})
