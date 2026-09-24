import { describe, expect, it } from 'vitest'
import {
  isCurrentAskRequest,
  reduceAskRequestState,
  type AskRequestsState
} from './ask-request-state'

const startTwoRequests = (): AskRequestsState => {
  const first = reduceAskRequestState(new Map(), {
    type: 'start', sessionId: 'ask-a', requestId: 'request-a'
  })
  return reduceAskRequestState(first, {
    type: 'start', sessionId: 'ask-b', requestId: 'request-b'
  })
}

describe('per-Ask request lifecycle', () => {
  it('allows different Asks to remain pending together', () => {
    const state = startTwoRequests()

    expect(isCurrentAskRequest(state, 'ask-a', 'request-a')).toBe(true)
    expect(isCurrentAskRequest(state, 'ask-b', 'request-b')).toBe(true)
    expect(isCurrentAskRequest(state, 'ask-a', 'request-b')).toBe(false)
    expect(state.get('ask-c')).toBeUndefined()
  })

  it('ignores duplicate submissions in the same Ask without replacing its request', () => {
    const state = startTwoRequests()

    expect(reduceAskRequestState(state, {
      type: 'start', sessionId: 'ask-a', requestId: 'duplicate-a'
    })).toBe(state)
  })

  it('completes requests out of order without clearing another Ask pending state', () => {
    const initial = startTwoRequests()
    const afterSecond = reduceAskRequestState(initial, {
      type: 'complete', sessionId: 'ask-b', requestId: 'request-b'
    })

    expect(afterSecond.get('ask-b')).toEqual({
      requestId: 'request-b', status: 'settled', error: null
    })
    expect(afterSecond.get('ask-a')).toBe(initial.get('ask-a'))
    expect(isCurrentAskRequest(afterSecond, 'ask-a', 'request-a')).toBe(true)
    expect(initial.get('ask-b')?.status).toBe('pending')

    const completed = reduceAskRequestState(afterSecond, {
      type: 'complete', sessionId: 'ask-a', requestId: 'request-a'
    })
    expect([...completed.values()].every((request) => request.status === 'settled')).toBe(true)
  })

  it('keeps errors with their originating Ask and clears them on its retry', () => {
    const initial = startTwoRequests()
    const failed = reduceAskRequestState(initial, {
      type: 'complete', sessionId: 'ask-a', requestId: 'request-a', error: '服务商 unavailable'
    })

    expect(failed.get('ask-a')?.error).toBe('服务商 unavailable')
    expect(failed.get('ask-b')).toBe(initial.get('ask-b'))

    const retry = reduceAskRequestState(failed, {
      type: 'start', sessionId: 'ask-a', requestId: 'retry-a'
    })
    expect(retry.get('ask-a')).toEqual({ requestId: 'retry-a', status: 'pending', error: null })
  })

  it('stops only the chosen Ask and discards its late reply', () => {
    const initial = startTwoRequests()
    const stopped = reduceAskRequestState(initial, {
      type: 'stop', sessionId: 'ask-a', requestId: 'request-a'
    })

    expect(isCurrentAskRequest(stopped, 'ask-a', 'request-a')).toBe(false)
    expect(stopped.get('ask-a')?.status).toBe('stopped')
    expect(isCurrentAskRequest(stopped, 'ask-b', 'request-b')).toBe(true)
    expect(reduceAskRequestState(stopped, {
      type: 'complete', sessionId: 'ask-a', requestId: 'request-a'
    })).toBe(stopped)
  })

  it('ignores old completion and cancellation failures after stopping and resending', () => {
    const stopped = reduceAskRequestState(startTwoRequests(), {
      type: 'stop', sessionId: 'ask-a', requestId: 'request-a'
    })
    const retry = reduceAskRequestState(stopped, {
      type: 'start', sessionId: 'ask-a', requestId: 'retry-a'
    })

    expect(reduceAskRequestState(retry, {
      type: 'complete', sessionId: 'ask-a', requestId: 'request-a', error: 'Old failure'
    })).toBe(retry)
    expect(reduceAskRequestState(retry, {
      type: 'cancelFailed', sessionId: 'ask-a', requestId: 'request-a', error: 'Old cancel failure'
    })).toBe(retry)
    expect(isCurrentAskRequest(retry, 'ask-a', 'retry-a')).toBe(true)
  })

  it('records a cancellation error only for the stopped request', () => {
    const initial = startTwoRequests()
    expect(reduceAskRequestState(initial, {
      type: 'cancelFailed', sessionId: 'ask-a', requestId: 'request-a', error: 'Not stopped'
    })).toBe(initial)

    const stopped = reduceAskRequestState(initial, {
      type: 'stop', sessionId: 'ask-a', requestId: 'request-a'
    })
    const failed = reduceAskRequestState(stopped, {
      type: 'cancelFailed', sessionId: 'ask-a', requestId: 'request-a', error: 'Unable to cancel'
    })
    expect(failed.get('ask-a')).toEqual({
      requestId: 'request-a', status: 'stopped', error: 'Unable to cancel'
    })
    expect(failed.get('ask-b')).toBe(initial.get('ask-b'))
  })

  it('does not remove pending state and ignores callbacks after a stopped Ask is deleted', () => {
    const initial = startTwoRequests()
    expect(reduceAskRequestState(initial, { type: 'remove', sessionId: 'ask-a' })).toBe(initial)

    const stopped = reduceAskRequestState(initial, {
      type: 'stop', sessionId: 'ask-a', requestId: 'request-a'
    })
    const removed = reduceAskRequestState(stopped, { type: 'remove', sessionId: 'ask-a' })
    expect(removed.has('ask-a')).toBe(false)
    expect(removed.get('ask-b')).toBe(initial.get('ask-b'))
    expect(reduceAskRequestState(removed, {
      type: 'cancelFailed', sessionId: 'ask-a', requestId: 'request-a', error: 'Late error'
    })).toBe(removed)
    expect(reduceAskRequestState(removed, {
      type: 'complete', sessionId: 'ask-a', requestId: 'request-a'
    })).toBe(removed)
  })
})
