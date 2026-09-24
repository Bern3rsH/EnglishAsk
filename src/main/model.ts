import type { GeminiModel } from '../shared/ai'

export const isGeminiModel = (value: unknown): value is GeminiModel => {
  try {
    return typeof value === 'string' && normalizeGeminiModel(value).length > 0
  } catch {
    return false
  }
}

export const normalizeGeminiModel = (value: unknown): GeminiModel => {
  if (typeof value !== 'string') {
    throw new Error('Gemini model must be a string.')
  }

  const model = value.trim().replace(/^models\//, '')

  if (model.length === 0) {
    throw new Error('Gemini model cannot be empty.')
  }

  if (/\s/.test(model)) {
    throw new Error('Gemini model cannot contain whitespace.')
  }

  if (model.length > 120) {
    throw new Error('Gemini model must be 120 characters or fewer.')
  }

  return model
}
