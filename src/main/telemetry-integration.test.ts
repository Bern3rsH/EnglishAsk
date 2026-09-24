import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const mainSourcePath = new URL('./index.ts', import.meta.url)
const preloadSourcePath = new URL('../preload/index.ts', import.meta.url)
const rendererSourcePath = new URL('../renderer/src/App.tsx', import.meta.url)
const rendererTypesPath = new URL('../renderer/src/env.d.ts', import.meta.url)
const sharedTypesPath = new URL('../shared/ai.ts', import.meta.url)
const environmentExamplePath = new URL('../../.env.example', import.meta.url)

describe('telemetry integration', () => {
  it('wires bounded renderer events through preload to the main process', async () => {
    const [mainSource, preloadSource, rendererSource, rendererTypes, sharedTypes] =
      await Promise.all([
        readFile(mainSourcePath, 'utf8'),
        readFile(preloadSourcePath, 'utf8'),
        readFile(rendererSourcePath, 'utf8'),
        readFile(rendererTypesPath, 'utf8'),
        readFile(sharedTypesPath, 'utf8')
      ])

    expect(sharedTypes).toContain(
      "CAPTURE_TELEMETRY_EVENT_CHANNEL = 'english-ask:capture-telemetry-event'"
    )
    expect(mainSource).toContain('isTelemetryEventName(eventName)')
    expect(mainSource).toContain('isTelemetryEventProperties(properties)')
    expect(preloadSource).toContain(
      'ipcRenderer.send(CAPTURE_TELEMETRY_EVENT_CHANNEL, eventName, properties)'
    )
    expect(rendererTypes).toContain('captureTelemetryEvent: (')
    expect(rendererSource).toContain("captureTelemetryEvent('view_changed', { view: telemetryView })")
  })

  it('captures the core app, Ask, and Note lifecycle without content properties', async () => {
    const mainSource = await readFile(mainSourcePath, 'utf8')

    expect(mainSource).toContain('initializeTelemetry()')
    expect(mainSource).toContain("captureTelemetryEvent('app_opened')")
    expect(mainSource).toContain("captureTelemetryEvent('ask_submitted'")
    expect(mainSource).toContain("captureTelemetryEvent('ask_completed'")
    expect(mainSource).toContain("captureTelemetryEvent('note_created'")
    expect(mainSource).not.toMatch(/captureTelemetryEvent\([^)]*question:/s)
    expect(mainSource).not.toMatch(/captureTelemetryEvent\([^)]*markdown:/s)
  })

  it('documents opt-in configuration and operational switches', async () => {
    const environmentExample = await readFile(environmentExamplePath, 'utf8')

    expect(environmentExample).toContain('VITE_POSTHOG_KEY=')
    expect(environmentExample).toContain('VITE_POSTHOG_HOST=https://us.i.posthog.com')
    expect(environmentExample).toContain('VITE_TELEMETRY_DISABLED=')
    expect(environmentExample).toContain('VITE_TELEMETRY_DEBUG=')
  })
})
