import { describe, expect, it } from 'vitest'
import { AskRequestCancellationRegistry, isAbortError } from './ask-cancellation'

describe('AskRequestCancellationRegistry', () => {
  it('aborts the active controller for a request ID', () => {
    const registry = new AskRequestCancellationRegistry()
    const controller = registry.start('request-1')

    expect(registry.cancel('request-1')).toBe(true)
    expect(controller.signal.aborted).toBe(true)
  })

  it('rejects duplicate active request IDs', () => {
    const registry = new AskRequestCancellationRegistry()
    registry.start('request-1')

    expect(() => registry.start('request-1')).toThrow(
      'A request with this ID is already running.'
    )
  })

  it('keeps concurrent requests independent when one is cancelled or completed', () => {
    const registry = new AskRequestCancellationRegistry()
    const first = registry.start('request-a')
    const second = registry.start('request-b')

    expect(registry.cancel('request-a')).toBe(true)
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)

    registry.finish('request-a', first)
    expect(registry.cancel('request-a')).toBe(false)
    expect(registry.cancel('request-b')).toBe(true)
    expect(second.signal.aborted).toBe(true)
  })

  it('removes only the matching completed controller', () => {
    const registry = new AskRequestCancellationRegistry()
    const controller = registry.start('request-1')
    const unrelatedController = new AbortController()

    registry.finish('request-1', unrelatedController)
    expect(registry.cancel('request-1')).toBe(true)

    registry.finish('request-1', controller)
    expect(registry.cancel('request-1')).toBe(false)
  })
})

describe('isAbortError', () => {
  it('recognizes AbortError instances without treating ordinary errors as cancellation', () => {
    const abortError = new Error('stopped')
    abortError.name = 'AbortError'

    expect(isAbortError(abortError)).toBe(true)
    expect(isAbortError(new Error('failed'))).toBe(false)
  })
})
