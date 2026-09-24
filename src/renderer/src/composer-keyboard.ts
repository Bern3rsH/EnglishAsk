const IME_PROCESSING_KEY_CODE = 229

type ComposerKeyboardEvent = {
  key: string
  shiftKey: boolean
  nativeEvent: {
    isComposing?: boolean
    keyCode?: number
  }
}

export const shouldSubmitComposerOnKeyDown = (event: ComposerKeyboardEvent): boolean =>
  event.key === 'Enter' &&
  !event.shiftKey &&
  event.nativeEvent.isComposing !== true &&
  event.nativeEvent.keyCode !== IME_PROCESSING_KEY_CODE
