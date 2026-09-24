import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  isTelemetryEventName,
  isTelemetryEventProperties
} from '../shared/ai'
import {
  normalizePostHogHost,
  sanitizeTelemetryProperties,
  TelemetryClient
} from './telemetry'

const createClient = async (overrides: { posthogKey?: string; fetchImpl?: typeof fetch; debug?: boolean } = {}) => {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'english-ask-telemetry-'))
  const storagePath = join(storageDirectory, 'telemetry.json')
  const fetchImpl =
    overrides.fetchImpl ??
    (vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 1 }), { status: 200 })) as typeof fetch)

  return {
    client: new TelemetryClient({
      appVersion: '0.1.0',
      environment: 'development',
      platform: 'darwin',
      arch: 'arm64',
      packaged: false,
      posthogKey: overrides.posthogKey ?? 'phc_test',
      posthogHost: 'https://us.i.posthog.com/',
      storagePath,
      debug: overrides.debug ?? false,
      fetchImpl,
      createInstallId: () => 'anonymous-install-id'
    }),
    fetchImpl,
    storagePath
  }
}

describe('PostHog telemetry', () => {
  it.each([
    [200, JSON.stringify({ status: 0, error: 'Invalid token' })],
    [503, 'Unavailable'],
    [200, 'invalid json']
  ])('handles rejected responses without breaking the app (%s)', async (status, body) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response(body, { status }))
      const { client } = await createClient({ fetchImpl, debug: true })
      await expect(client.captureEvent('app_opened')).resolves.toBeUndefined()
      await client.captureEvent('app_opened')
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('absorbs synchronous network errors and protects routing and identity properties', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => { throw new Error('offline') })
    const { client } = await createClient({ fetchImpl })
    await expect(client.captureEvent('app_opened', { app_name: 'wrong', distinct_id: 'wrong', app_environment: 'wrong', $process_person_profile: true })).resolves.toBeUndefined()
    const payload = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(payload.api_key).toBe('phc_test')
    expect(payload.properties.app_name).toBe('EnglishAsk')
    expect(payload.properties.app_environment).toBe('development')
    expect(payload.properties.$process_person_profile).toBe(false)
    expect(payload.distinct_id).toBe('englishask:anonymous-install-id')
    expect(payload.properties.distinct_id).toBe(payload.distinct_id)
    expect(payload.timestamp).toEqual(expect.any(String))
  })

  it('accepts only the bounded event names and primitive property values', () => {
    expect(isTelemetryEventName('ask_completed')).toBe(true)
    expect(isTelemetryEventName('question_contents')).toBe(false)
    expect(isTelemetryEventProperties({ outcome: 'success', duration_ms: 25 })).toBe(true)
    expect(isTelemetryEventProperties({ content: { question: 'secret' } })).toBe(false)
    expect(isTelemetryEventProperties(['view_changed'])).toBe(false)
  })

  it('normalizes hosts and removes unsupported or non-finite properties', () => {
    expect(normalizePostHogHost('https://eu.i.posthog.com///')).toBe(
      'https://eu.i.posthog.com'
    )
    expect(
      sanitizeTelemetryProperties({
        outcome: 'success',
        duration_ms: 12,
        optional: undefined,
        invalid_number: Number.NaN
      })
    ).toEqual({ outcome: 'success', duration_ms: 12 })
  })

  it('posts an anonymous event and persists a stable installation ID', async () => {
    const { client, fetchImpl, storagePath } = await createClient()

    client.captureEvent('ask_completed', {
      outcome: 'success',
      duration_ms: 40
    })

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce())

    const [url, request] = vi.mocked(fetchImpl).mock.calls[0]
    const payload = JSON.parse(String(request?.body)) as Record<string, unknown>
    const properties = payload.properties as Record<string, unknown>

    expect(url).toBe('https://us.i.posthog.com/i/v0/e/')
    expect(payload).toMatchObject({
      event: 'ask_completed'
    })
    expect(properties).toMatchObject({
      app_version: '0.1.0',
      app_environment: 'development',
      platform: 'darwin',
      arch: 'arm64',
      packaged: false,
      app_name: 'EnglishAsk',
      distinct_id: 'englishask:anonymous-install-id',
      $process_person_profile: false,
      outcome: 'success',
      duration_ms: 40
    })
    expect(JSON.parse(await readFile(storagePath, 'utf8'))).toEqual({
      anonymousInstallId: 'anonymous-install-id'
    })
  })

  it('does not create an identity or make a request without a project token', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const { client, storagePath } = await createClient({
      posthogKey: '',
      fetchImpl: fetchImpl as typeof fetch
    })

    client.captureEvent('app_opened')

    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(readFile(storagePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
