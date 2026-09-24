import { describe, expect, it } from 'vitest'

import { isNewItemShortcut } from './app-shortcuts'

const createKeyboardEvent = (
  overrides: Partial<Parameters<typeof isNewItemShortcut>[0]> = {}
): Parameters<typeof isNewItemShortcut>[0] => ({
  altKey: false,
  ctrlKey: false,
  key: 'n',
  metaKey: true,
  repeat: false,
  shiftKey: false,
  ...overrides
})

describe('application shortcuts', () => {
  it.each(['n', 'N'])('recognizes Cmd+%s as the new-item shortcut', (key) => {
    expect(isNewItemShortcut(createKeyboardEvent({ key }))).toBe(true)
  })

  it.each([
    { metaKey: false },
    { ctrlKey: true },
    { altKey: true },
    { shiftKey: true },
    { repeat: true },
    { key: 'm' },
    { key: '' }
  ])('rejects unrelated or repeating keyboard input: %j', (overrides) => {
    expect(isNewItemShortcut(createKeyboardEvent(overrides))).toBe(false)
  })
})
