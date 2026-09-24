type AppShortcutKeyboardEvent = {
  altKey: boolean
  ctrlKey: boolean
  key: string
  metaKey: boolean
  repeat: boolean
  shiftKey: boolean
}

export const isNewItemShortcut = (event: AppShortcutKeyboardEvent): boolean =>
  event.metaKey &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.shiftKey &&
  !event.repeat &&
  event.key.toLowerCase() === 'n'
