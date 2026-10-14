import { afterEach, expect, it, vi } from 'vitest'
import { decideNotesWithJev, JEV_NOTE_QUESTIONS } from './jev-note-routing'
import { JEV_CHANNELS, type JevChannel } from '../shared/jev'

const request = { question: '我的笔记里draw attention to的例句', history: [] }
const configuration = { channel: 'openrouter' as const, apiKey: 'dedicated-key' }
const response = (route = 'notes', queryMode = 'direct', confidence = 0.95) => ({ model: 'jev-test', answers: {
  route: { type: 'choice', choice: route, confidence, probabilities: { standard: route === 'standard' ? 1 : 0, notes: route === 'notes' ? 1 : 0 } },
  queryMode: { type: 'choice', choice: queryMode, confidence, probabilities: { direct: queryMode === 'direct' ? 1 : 0, contextual: queryMode === 'contextual' ? 1 : 0 } }
} })
afterEach(() => vi.unstubAllGlobals())

it('shares the saved-channel transport while sending only the Notes choice contract', async () => {
  for (const channel of Object.keys(JEV_CHANNELS) as JevChannel[]) {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(channel === 'cloudflare'
      ? { success: true, result: response() } : response()))
    vi.stubGlobal('fetch', fetchMock)
    expect(await decideNotesWithJev(request, { ...configuration, channel, accountId: 'a'.repeat(32) }))
      .toEqual({ route: 'notes', queryMode: 'direct' })
    const [endpoint, options] = fetchMock.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(options.headers.Authorization).toBe('Bearer dedicated-key')
    expect(options.redirect).toBe('error')
    expect(body.model).toBe(JEV_CHANNELS[channel].model)
    const input = channel === 'cloudflare' ? body.input : body
    expect(input.questions).toEqual(JEV_NOTE_QUESTIONS)
    expect(input.state).toContain(request.question)
    expect(input.state).not.toContain('dedicated-key')
    expect(endpoint).toContain(channel === 'vercel' ? 'ai-gateway.vercel.sh'
      : channel === 'typesafe' ? 'api.typesafe.ai' : channel === 'cloudflare' ? 'api.cloudflare.com' : 'openrouter.ai')
  }
})

it('rejects low confidence, invalid choices, probabilities and inconsistent query modes', async () => {
  const missingProbabilities = response()
  missingProbabilities.answers.route.probabilities.notes = Number.NaN
  for (const data of [response('notes', 'direct', 0.79), response('notes', 'direct', 1.1),
    response('bad', 'direct'), response('standard', 'contextual'), missingProbabilities, { model: 'x', answers: {} }]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)))
    await expect(decideNotesWithJev(request, configuration)).rejects.toThrow()
  }
})

it('accepts the shared confidence boundary and contextual Notes choices', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(response('notes', 'contextual', 0.8))))
  expect(await decideNotesWithJev(request, configuration)).toEqual({ route: 'notes', queryMode: 'contextual' })
})

it('preserves cancellation and sanitizes HTTP errors', async () => {
  const controller = new AbortController()
  controller.abort()
  const fetchMock = vi.fn().mockResolvedValue(new Response('secret details', { status: 500 }))
  vi.stubGlobal('fetch', fetchMock)
  await expect(decideNotesWithJev(request, configuration, controller.signal)).rejects.toThrow()
  expect(fetchMock).not.toHaveBeenCalled()
  await expect(decideNotesWithJev(request, configuration)).rejects.toThrow('Jev routing HTTP 500')
})
