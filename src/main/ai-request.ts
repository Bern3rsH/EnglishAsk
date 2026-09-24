import type { AskEnglishRequest, ChatMessage } from '../shared/ai'

export const MAX_QUESTION_CHARACTERS = 4000
export const MAX_HISTORY_MESSAGES = 12
export const MAX_REQUEST_ID_CHARACTERS = 128
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash'

const validRoles = new Set(['user', 'assistant'])

export const ENGLISH_ASK_SYSTEM_PROMPT = `You are EnglishAsk, an English learning assistant.

Give a complete, learner-focused answer and adapt the depth to the question.
For a word or expression, normally explain its meaning, natural usage, register, and provide two or three varied examples when useful.
Mention common mistakes or important distinctions when relevant.
Avoid unnecessary repetition, but do not omit useful learning information.
Correct mistakes gently and preserve the user's intended meaning.`

const assertRecord = (value: unknown): asserts value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Request must be an object.')
  }
}

const normalizeQuestion = (question: unknown): string => {
  if (typeof question !== 'string') {
    throw new Error('Question must be a string.')
  }

  const normalizedQuestion = question.trim()

  if (normalizedQuestion.length === 0) {
    throw new Error('Question cannot be empty.')
  }

  if (normalizedQuestion.length > MAX_QUESTION_CHARACTERS) {
    throw new Error(`Question must be ${MAX_QUESTION_CHARACTERS} characters or fewer.`)
  }

  return normalizedQuestion
}

export const validateAskEnglishRequestId = (requestId: unknown): string => {
  if (typeof requestId !== 'string') {
    throw new Error('Request ID must be a string.')
  }

  const normalizedRequestId = requestId.trim()

  if (normalizedRequestId.length === 0) {
    throw new Error('Request ID cannot be empty.')
  }

  if (normalizedRequestId.length > MAX_REQUEST_ID_CHARACTERS) {
    throw new Error(`Request ID must be ${MAX_REQUEST_ID_CHARACTERS} characters or fewer.`)
  }

  return normalizedRequestId
}

const normalizeHistoryMessage = (message: unknown): ChatMessage | null => {
  if (typeof message !== 'object' || message === null) {
    return null
  }

  const candidate = message as Record<string, unknown>

  if (
    typeof candidate.id !== 'string' ||
    !validRoles.has(String(candidate.role)) ||
    typeof candidate.content !== 'string' ||
    typeof candidate.createdAt !== 'string'
  ) {
    return null
  }

  const content = candidate.content.trim()

  if (content.length === 0) {
    return null
  }

  return {
    id: candidate.id,
    role: candidate.role as ChatMessage['role'],
    content,
    createdAt: candidate.createdAt
  }
}

const normalizeHistory = (history: unknown): ChatMessage[] => {
  if (!Array.isArray(history)) {
    return []
  }

  return history
    .map(normalizeHistoryMessage)
    .filter((message): message is ChatMessage => message !== null)
    .slice(-MAX_HISTORY_MESSAGES)
}

export const validateAskEnglishRequest = (input: unknown): AskEnglishRequest => {
  assertRecord(input)

  return {
    requestId: validateAskEnglishRequestId(input.requestId),
    ...(input.retryOfRequestId === undefined ? {} : {
      retryOfRequestId: validateAskEnglishRequestId(input.retryOfRequestId)
    }),
    question: normalizeQuestion(input.question),
    history: normalizeHistory(input.history)
  }
}

export const buildEnglishAskPrompt = (request: AskEnglishRequest): string => {
  const historyText = request.history
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n')

  if (historyText.length === 0) {
    return `User: ${request.question}`
  }

  return `${historyText}\nUser: ${request.question}`
}
