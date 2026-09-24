import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { TelemetryEventName, TelemetryEventProperties } from '../shared/ai'

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'
const POSTHOG_CAPTURE_PATH = '/i/v0/e/'
const TELEMETRY_FILE_NAME = 'telemetry.json'
const TELEMETRY_FILE_MODE = 0o600
const TELEMETRY_REQUEST_TIMEOUT_MS = 2500
const POSTHOG_FAILURE_LOG_LIMIT = 1
const MAX_DISTINCT_ID_LENGTH = 200

interface StoredTelemetryState {
  anonymousInstallId: string
}

interface TelemetryClientOptions {
  appVersion: string
  environment: 'development' | 'production'
  platform: string
  arch: string
  packaged: boolean
  posthogKey: string
  posthogHost: string
  storagePath: string
  debug: boolean
  fetchImpl?: typeof fetch
  createInstallId?: () => string
}

const getOptionalEnvValue = (...values: Array<string | undefined>): string => {
  for (const value of values) {
    const normalizedValue = value?.trim()

    if (normalizedValue) {
      return normalizedValue
    }
  }

  return ''
}

const isEnabledEnvironmentValue = (value: string): boolean => {
  return ['1', 'true', 'yes'].includes(value.toLowerCase())
}

export const normalizePostHogHost = (rawHost: string): string => {
  const normalizedHost = rawHost.trim().replace(/\/+$/, '')
  return normalizedHost || DEFAULT_POSTHOG_HOST
}

export const sanitizeTelemetryProperties = (
  properties: TelemetryEventProperties = {}
): TelemetryEventProperties => {
  const sanitizedProperties: TelemetryEventProperties = {}

  for (const [key, value] of Object.entries(properties)) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      sanitizedProperties[key] = value
    }
  }

  return sanitizedProperties
}

export class TelemetryClient {
  private readonly fetchImpl: typeof fetch
  private readonly createInstallId: () => string
  private anonymousInstallId: string | null = null
  private failureLogCount = 0

  constructor(private readonly options: TelemetryClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.createInstallId = options.createInstallId ?? randomUUID
  }

  captureEvent(
    eventName: TelemetryEventName,
    properties: TelemetryEventProperties = {}
  ): Promise<void> {
    if (!this.options.posthogKey) {
      return Promise.resolve()
    }

    const abortController = new AbortController()
    const timeoutId = setTimeout(
      () => abortController.abort(),
      TELEMETRY_REQUEST_TIMEOUT_MS
    )
    const commonProperties: TelemetryEventProperties = {
      app_version: this.options.appVersion,
      app_environment: this.options.environment,
      platform: this.options.platform,
      arch: this.options.arch,
      packaged: this.options.packaged,
      app_name: 'EnglishAsk',
      $process_person_profile: false,
      $geoip_disable: true
    }

    return Promise.resolve()
      .then(() => {
        const distinctId = `englishask:${this.getAnonymousInstallId()}`
        return this.fetchImpl(
          `${normalizePostHogHost(this.options.posthogHost)}${POSTHOG_CAPTURE_PATH}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              api_key: this.options.posthogKey,
              event: eventName,
              distinct_id: distinctId,
              timestamp: new Date().toISOString(),
              properties: {
                ...sanitizeTelemetryProperties(properties),
                ...commonProperties,
                distinct_id: distinctId
              }
            }),
            signal: abortController.signal
          }
        )
      })
      .then(async (response) => {
        if (!response.ok) {
          this.logFailure(`[Telemetry] PostHog capture returned HTTP ${response.status}.`)
          return
        }
        const result = await response.json() as { status?: number | string }
        if (result.status !== 1 && result.status !== 'Ok') {
          this.logFailure('[Telemetry] PostHog rejected the event.')
        }
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') {
          this.logFailure('[Telemetry] PostHog capture timed out.')
          return
        }

        this.logFailure('[Telemetry] PostHog capture failed.', error)
      })
      .finally(() => {
        clearTimeout(timeoutId)
      })
  }

  private getAnonymousInstallId(): string {
    if (this.anonymousInstallId) {
      return this.anonymousInstallId
    }

    try {
      const storedState = JSON.parse(
        readFileSync(this.options.storagePath, 'utf8')
      ) as Partial<StoredTelemetryState>
      const storedInstallId = storedState.anonymousInstallId?.trim()

      if (storedInstallId && storedInstallId.length <= MAX_DISTINCT_ID_LENGTH) {
        this.anonymousInstallId = storedInstallId
        return storedInstallId
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        this.logFailure('[Telemetry] Unable to read anonymous installation ID.', error)
      }
    }

    const nextInstallId = this.createInstallId()
    this.anonymousInstallId = nextInstallId

    try {
      mkdirSync(dirname(this.options.storagePath), { recursive: true })
      writeFileSync(
        this.options.storagePath,
        `${JSON.stringify({ anonymousInstallId: nextInstallId }, null, 2)}\n`,
        { encoding: 'utf8', mode: TELEMETRY_FILE_MODE }
      )
      chmodSync(this.options.storagePath, TELEMETRY_FILE_MODE)
    } catch (error) {
      this.logFailure('[Telemetry] Unable to persist anonymous installation ID.', error)
    }

    return nextInstallId
  }

  private logFailure(message: string, error?: unknown): void {
    if (!this.options.debug || this.failureLogCount >= POSTHOG_FAILURE_LOG_LIMIT) {
      return
    }

    this.failureLogCount += 1

    if (error) {
      console.warn(message, error)
      return
    }

    console.warn(message)
  }
}

let telemetryClient: TelemetryClient | null = null

export const initializeTelemetry = (): void => {
  telemetryClient = null
  const telemetryDisabled = isEnabledEnvironmentValue(
    getOptionalEnvValue(
      process.env.ENGLISH_ASK_TELEMETRY_DISABLED,
      import.meta.env.VITE_TELEMETRY_DISABLED
    )
  )

  if (telemetryDisabled) {
    console.info('[Telemetry] Disabled by environment.')
    return
  }

  const posthogKey = getOptionalEnvValue(
    process.env.ENGLISH_ASK_POSTHOG_KEY,
    import.meta.env.VITE_POSTHOG_KEY
  )

  telemetryClient = new TelemetryClient({
    appVersion: app.getVersion(),
    environment: app.isPackaged ? 'production' : 'development',
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    posthogKey,
    posthogHost: getOptionalEnvValue(
      process.env.ENGLISH_ASK_POSTHOG_HOST,
      import.meta.env.VITE_POSTHOG_HOST
    ) || DEFAULT_POSTHOG_HOST,
    storagePath: join(app.getPath('userData'), TELEMETRY_FILE_NAME),
    debug: isEnabledEnvironmentValue(
      getOptionalEnvValue(
        process.env.ENGLISH_ASK_TELEMETRY_DEBUG,
        import.meta.env.VITE_TELEMETRY_DEBUG
      )
    )
  })

  console.info(`[Telemetry] PostHog ${posthogKey ? 'enabled' : 'disabled'}.`)
}

export const captureTelemetryEvent = (
  eventName: TelemetryEventName,
  properties: TelemetryEventProperties = {}
): void => {
  void telemetryClient?.captureEvent(eventName, properties)
}
