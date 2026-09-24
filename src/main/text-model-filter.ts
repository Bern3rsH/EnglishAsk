const NON_TEXT_MODEL_MARKERS = [
  'audio',
  'computer-use',
  'dall-e',
  'embed',
  'embedding',
  'guard',
  'image',
  'imagen',
  'live',
  'lyria',
  'moderation',
  'native-audio',
  'omni',
  'realtime',
  'rerank',
  'safety',
  'speech',
  'transcribe',
  'tts',
  'veo',
  'video',
  'vision',
  'whisper'
] as const

const normalizeModelIdForFiltering = (modelId: string): string => {
  return modelId.trim().toLowerCase()
}

export const isTextModelId = (modelId: string): boolean => {
  const normalizedModelId = normalizeModelIdForFiltering(modelId)

  if (normalizedModelId.length === 0) {
    return false
  }

  return !NON_TEXT_MODEL_MARKERS.some((marker) => normalizedModelId.includes(marker))
}

export const filterTextModelIds = (modelIds: readonly string[]): string[] => {
  return modelIds.filter(isTextModelId)
}
