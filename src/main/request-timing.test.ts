import { afterEach, expect, it, vi } from 'vitest'
import { measureModelRequest } from './request-timing'

afterEach(() => vi.restoreAllMocks())
const metadata = { purpose: 'routing' as const, modelProvider: 'deepseek' as const, modelName: 'test-model' }

it('measures success without changing the result or leaking payload fields', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(22)
  const result = { answer: 'private-answer' }
  expect(await measureModelRequest({ ...metadata, ...{ apiKey: 'secret', prompt: 'private-question' } }, async () => result)).toBe(result)
  expect(log.mock.calls[1][1]).toMatchObject({ stage: 'routing', elapsedMs: 12, outcome: 'success' })
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|private-question|private-answer/)
  expect(log.mock.calls[0][1].callId).toBe(log.mock.calls[1][1].callId)
})

it.each([false, true])('preserves failures and identifies cancellation: %s', async cancelled => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const controller = new AbortController()
  if (cancelled) controller.abort()
  const failure = new Error('private request details')
  await expect(measureModelRequest({ ...metadata, signal: controller.signal }, async () => { throw failure })).rejects.toBe(failure)
  expect(log.mock.calls[1][1].outcome).toBe(cancelled ? 'cancelled' : 'failed')
  expect(JSON.stringify(log.mock.calls)).not.toContain(failure.message)
})

it('gives concurrent calls distinct identifiers', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  await Promise.all([measureModelRequest(metadata, async () => 1), measureModelRequest(metadata, async () => 2)])
  const starts = log.mock.calls.filter(([event]) => event.endsWith('started'))
  expect(new Set(starts.map(([, value]) => value.callId)).size).toBe(2)
})
