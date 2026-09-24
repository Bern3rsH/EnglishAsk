import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEnv } from 'vite'
import { expect, it } from 'vitest'
import { TelemetryClient } from './telemetry'

it.skipIf(process.env.POSTHOG_LIVE_VERIFY !== '1')('delivers a synthetic event to the configured PostHog project', async () => {
  const env = loadEnv('development', process.cwd(), 'VITE_')
  expect(env.VITE_POSTHOG_KEY).toBeTruthy()
  const directory = await mkdtemp(join(tmpdir(), 'english-ask-posthog-'))
  let accepted = false
  try {
    const client = new TelemetryClient({
      appVersion: '0.1.0', environment: 'development', platform: process.platform,
      arch: process.arch, packaged: false, posthogKey: env.VITE_POSTHOG_KEY,
      posthogHost: env.VITE_POSTHOG_HOST, storagePath: join(directory, 'telemetry.json'),
      debug: true,
      fetchImpl: async (url, init) => {
        const response = await fetch(url, init)
        const body = await response.clone().json() as { status?: number | string }
        accepted = response.ok && (body.status === 1 || body.status === 'Ok')
        return response
      }
    })
    await client.captureEvent('app_opened', { integration_verification: true })
    expect(accepted).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
