import type { TelemetryEventName, TelemetryEventProperties } from '../../shared/ai'

export const captureTelemetryEvent = (
  eventName: TelemetryEventName,
  properties: TelemetryEventProperties = {}
): void => {
  try {
    window.englishAsk?.captureTelemetryEvent(eventName, properties)
  } catch (error) {
    console.warn('[Telemetry] Failed to send renderer event.', error)
  }
}
