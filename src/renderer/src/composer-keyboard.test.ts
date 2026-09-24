import { describe, expect, it } from 'vitest'

import { shouldSubmitComposerOnKeyDown } from './composer-keyboard'

describe('composer keyboard behavior', () => {
  it('submits a normal Enter key press', () => {
    expect(
      shouldSubmitComposerOnKeyDown({
        key: 'Enter',
        shiftKey: false,
        nativeEvent: {}
      })
    ).toBe(true)
  })

  it('keeps Shift+Enter available for new lines', () => {
    expect(
      shouldSubmitComposerOnKeyDown({
        key: 'Enter',
        shiftKey: true,
        nativeEvent: {}
      })
    ).toBe(false)
  })

  it('does not submit while an IME composition is being confirmed', () => {
    expect(
      shouldSubmitComposerOnKeyDown({
        key: 'Enter',
        shiftKey: false,
        nativeEvent: {
          isComposing: true
        }
      })
    ).toBe(false)
  })

  it('does not submit legacy IME processing Enter events', () => {
    expect(
      shouldSubmitComposerOnKeyDown({
        key: 'Enter',
        shiftKey: false,
        nativeEvent: {
          keyCode: 229
        }
      })
    ).toBe(false)
  })
})
