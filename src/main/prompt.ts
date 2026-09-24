import { ENGLISH_ASK_SYSTEM_PROMPT } from './ai-request'

export const MAX_SYSTEM_PROMPT_CHARACTERS = 8000
export const LEGACY_ENGLISH_ASK_SYSTEM_PROMPTS = [
  'You are EnglishAsk, a concise English learning assistant. Answer in clear English, correct mistakes gently, and include a short improved version when the user asks in imperfect English.',
  'You are EnglishAsk, a concise English learning assistant.  Correct mistakes gently, and include a short improved version when the user asks in imperfect English.'
] as const

const legacySystemPrompts = new Set<string>(LEGACY_ENGLISH_ASK_SYSTEM_PROMPTS)

export const normalizeSystemPrompt = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('System prompt must be a string.')
  }

  const normalizedPrompt = value.trim()

  if (normalizedPrompt.length === 0) {
    throw new Error('System prompt cannot be empty.')
  }

  if (normalizedPrompt.length > MAX_SYSTEM_PROMPT_CHARACTERS) {
    throw new Error(`System prompt must be ${MAX_SYSTEM_PROMPT_CHARACTERS} characters or fewer.`)
  }

  return normalizedPrompt
}

export const getDefaultSystemPrompt = (): string => {
  return ENGLISH_ASK_SYSTEM_PROMPT
}

export const normalizeStoredSystemPrompt = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalizedPrompt = value.trim()

  if (normalizedPrompt.length === 0) {
    return undefined
  }

  return legacySystemPrompts.has(normalizedPrompt)
    ? getDefaultSystemPrompt()
    : normalizedPrompt
}
