import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../shared/ai'
import {
  buildEnglishAskPrompt,
  MAX_HISTORY_MESSAGES,
  MAX_QUESTION_CHARACTERS,
  MAX_REQUEST_ID_CHARACTERS,
  validateAskEnglishRequest
} from './ai-request'

const createHistoryMessage = (index: number): ChatMessage => ({
  id: `message-${index}`,
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: `Message ${index}`,
  createdAt: new Date(2026, 0, index + 1).toISOString()
})

describe('validateAskEnglishRequest', () => {
  it('validates optional retry linkage using the same bounded request ID contract', () => {
    const input = { requestId: 'new', question: 'rain', history: [], retryOfRequestId: ' old ' }
    expect(validateAskEnglishRequest(input).retryOfRequestId).toBe('old')
    for (const retryOfRequestId of [null, 42, '', 'a'.repeat(MAX_REQUEST_ID_CHARACTERS + 1)]) {
      expect(() => validateAskEnglishRequest({ ...input, retryOfRequestId })).toThrow()
    }
  })
  it('normalizes the question and keeps only newest valid history messages', () => {
    const history = Array.from({ length: MAX_HISTORY_MESSAGES + 2 }, (_, index) =>
      createHistoryMessage(index)
    )

    const request = validateAskEnglishRequest({
      requestId: '  request-1  ',
      question: '  How do I say this naturally?  ',
      history: [{ role: 'system', content: 'ignored' }, ...history]
    })

    expect(request.question).toBe('How do I say this naturally?')
    expect(request.requestId).toBe('request-1')
    expect(request.history).toHaveLength(MAX_HISTORY_MESSAGES)
    expect(request.history[0]?.id).toBe('message-2')
  })

  it('ignores legacy per-question answer language overrides', () => {
    const request = validateAskEnglishRequest({
      requestId: 'request-1',
      question: 'Explain this word.',
      history: [],
      answerLanguageOverride: 'zh'
    })

    expect(request).toEqual({
      requestId: 'request-1',
      question: 'Explain this word.',
      history: []
    })
  })

  it('rejects empty questions', () => {
    expect(() =>
      validateAskEnglishRequest({
        requestId: 'request-1',
        question: '   ',
        history: []
      })
    ).toThrow('Question cannot be empty.')
  })

  it('rejects oversized questions', () => {
    expect(() =>
      validateAskEnglishRequest({
        requestId: 'request-1',
        question: 'a'.repeat(MAX_QUESTION_CHARACTERS + 1),
        history: []
      })
    ).toThrow(`Question must be ${MAX_QUESTION_CHARACTERS} characters or fewer.`)
  })

  it('rejects missing and oversized request IDs', () => {
    expect(() =>
      validateAskEnglishRequest({
        question: 'Explain this word.',
        history: []
      })
    ).toThrow('Request ID must be a string.')

    expect(() =>
      validateAskEnglishRequest({
        requestId: 'a'.repeat(MAX_REQUEST_ID_CHARACTERS + 1),
        question: 'Explain this word.',
        history: []
      })
    ).toThrow(`Request ID must be ${MAX_REQUEST_ID_CHARACTERS} characters or fewer.`)
  })

})

describe('buildEnglishAskPrompt', () => {
  it('renders prior turns before the current question', () => {
    const prompt = buildEnglishAskPrompt({
      requestId: 'request-1',
      question: 'What sounds better?',
      history: [createHistoryMessage(0), createHistoryMessage(1)]
    })

    expect(prompt).toBe('User: Message 0\nAssistant: Message 1\nUser: What sounds better?')
  })
})
