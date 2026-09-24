import { describe, expect, it } from 'vitest'
import {
  appendMessagesToSession,
  ASK_DELETE_CONFIRMATION_DETAIL,
  CHAT_TITLE_MAX_LENGTH,
  createChatSession,
  DEFAULT_CHAT_TITLE,
  deleteChatSession,
  filterChatSessions,
  getDeleteChatSessionConfirmationMessage,
  getChatSessionTitle,
  getNextActiveChatSessionIdAfterDelete,
  normalizeChatSessions,
  renameChatSession,
  shouldDeleteChatSession,
  sortChatSessionsByRecent,
  type ChatSession
} from './chat-history'
import type { ChatMessage } from '../../shared/ai'
import type { KnowledgeCard } from '../../shared/knowledge-card'
import type { RouterDiagnostic } from '../../shared/router'

const createMessage = (content: string, createdAt = '2026-06-30T10:00:00.000Z'): ChatMessage => {
  return {
    id: `message-${content}`,
    role: 'user',
    content,
    createdAt
  }
}

const routerDiagnostic: RouterDiagnostic = {
  status: 'success',
  classification: {
    inputType: 'comparison',
    structureType: 'multi_target_comparison',
    targetText: 'say vs tell',
    targets: ['say', 'tell'],
    focusText: '',
    intent: 'compare_difference',
    modules: ['comparison', 'usage', 'examples'],
    confidence: 0.96,
    needsClarification: false,
    clarificationQuestion: '',
    responseMode: 'card'
  }
}

const knowledgeCard: KnowledgeCard = {
  cardType: 'comparison',
  targetText: 'say vs tell',
  targets: ['say', 'tell'],
  answer: 'Use tell with a person object; say normally introduces the words.',
  sections: [
    {
      module: 'comparison',
      content: '| say | tell |\n| --- | --- |\n| say something | tell someone |'
    }
  ]
}

describe('chat history helpers', () => {
  it('preserves measured response time and accepts legacy messages without timing', () => {
    const session = createChatSession()
    session.messages = [{ ...createMessage('answer'), role: 'assistant', responseDurationMs: 12345 }]
    expect(normalizeChatSessions(JSON.parse(JSON.stringify([session])))[0].messages[0].responseDurationMs).toBe(12345)
    session.messages = [createMessage('legacy')]
    expect(normalizeChatSessions([session])[0].messages[0].responseDurationMs).toBeUndefined()
  })

  it.each([-1, Infinity, NaN, '123'])('rejects invalid persisted response timing: %s', duration => {
    const session = createChatSession()
    expect(normalizeChatSessions([{ ...session,
      messages: [{ ...createMessage('answer'), responseDurationMs: duration }] }])).toEqual([])
  })

  it('uses the first non-empty message as the chat title', () => {
    expect(getChatSessionTitle([])).toBe(DEFAULT_CHAT_TITLE)
    expect(getChatSessionTitle([createMessage('   '), createMessage('Practice daily greetings')])).toBe(
      'Practice daily greetings'
    )
  })

  it('appends messages to the target session and updates its title', () => {
    const session = createChatSession('2026-06-30T09:00:00.000Z')
    const otherSession = createChatSession('2026-06-30T09:05:00.000Z')
    const message = createMessage('How do I say this naturally?', '2026-06-30T10:10:00.000Z')

    const updatedSessions = appendMessagesToSession([session, otherSession], session.id, [message])

    expect(updatedSessions[0]?.messages).toEqual([message])
    expect(updatedSessions[0]?.title).toBe('How do I say this naturally?')
    expect(updatedSessions[0]?.updatedAt).toBe(message.createdAt)
    expect(updatedSessions[1]).toEqual(otherSession)
  })

  it('drops invalid stored sessions', () => {
    const session: ChatSession = {
      ...createChatSession('2026-06-30T09:00:00.000Z'),
      messages: [createMessage('Valid history')]
    }

    expect(normalizeChatSessions([session, { id: 'broken' }, null])).toEqual([session])
    expect(normalizeChatSessions({ sessions: [session] })).toEqual([])
  })

  it('restores valid 分类器 diagnostics and rejects malformed diagnostic history', () => {
    const session = createChatSession('2026-06-30T09:00:00.000Z')
    const assistantMessage: ChatMessage = {
      ...createMessage('Comparison answer'),
      role: 'assistant',
      routerDiagnostic
    }
    const sessionWithDiagnostic: ChatSession = {
      ...session,
      messages: [assistantMessage]
    }
    const malformedSession = {
      ...session,
      id: 'malformed-session',
      messages: [
        {
          ...assistantMessage,
          routerDiagnostic: {
            status: 'success',
            classification: {
              ...routerDiagnostic.classification,
              confidence: 'high'
            }
          }
        }
      ]
    }

    expect(normalizeChatSessions([sessionWithDiagnostic, malformedSession])).toEqual([
      sessionWithDiagnostic
    ])
  })

  it('restores assistant messages that already contain structured knowledge cards', () => {
    const session = createChatSession('2026-06-30T09:00:00.000Z')
    const assistantMessage: ChatMessage = {
      ...createMessage('Comparison answer'),
      id: 'assistant-message',
      role: 'assistant',
      answerLanguage: 'zh',
      routerDiagnostic,
      knowledgeCard
    }
    const sessionWithKnowledgeCard: ChatSession = {
      ...session,
      messages: [assistantMessage]
    }

    expect(normalizeChatSessions([sessionWithKnowledgeCard])).toEqual([
      sessionWithKnowledgeCard
    ])

    expect(
      normalizeChatSessions([
        {
          ...sessionWithKnowledgeCard,
          id: 'invalid-language-session',
          messages: [{ ...assistantMessage, answerLanguage: 'bilingual' }]
        }
      ])
    ).toEqual([])
  })

  it('filters sessions by title or message content', () => {
    const grammarSession: ChatSession = {
      ...createChatSession('2026-06-30T09:00:00.000Z'),
      title: 'Grammar help',
      messages: [createMessage('Can you fix this sentence?')]
    }
    const interviewSession: ChatSession = {
      ...createChatSession('2026-06-30T09:10:00.000Z'),
      title: 'Interview',
      messages: [createMessage('Tell me about yourself')]
    }

    expect(filterChatSessions([grammarSession, interviewSession], 'grammar')).toEqual([
      grammarSession
    ])
    expect(filterChatSessions([grammarSession, interviewSession], 'yourself')).toEqual([
      interviewSession
    ])
    expect(filterChatSessions([grammarSession], '   ')).toEqual([grammarSession])
  })

  it('sorts sessions by newest update first', () => {
    const olderSession = createChatSession('2026-06-30T09:00:00.000Z')
    const newerSession = createChatSession('2026-06-30T09:10:00.000Z')

    expect(sortChatSessionsByRecent([olderSession, newerSession])).toEqual([
      newerSession,
      olderSession
    ])
  })

  it('renames a session with title normalization', () => {
    const session = createChatSession('2026-06-30T09:00:00.000Z')
    const longTitle = 'A'.repeat(CHAT_TITLE_MAX_LENGTH + 8)

    const renamedSessions = renameChatSession(
      [session],
      session.id,
      longTitle,
      '2026-06-30T11:00:00.000Z'
    )

    expect(renamedSessions[0]?.title).toBe(`${'A'.repeat(CHAT_TITLE_MAX_LENGTH - 1)}…`)
    expect(renamedSessions[0]?.updatedAt).toBe('2026-06-30T11:00:00.000Z')
    expect(renameChatSession([session], session.id, '   ')[0]?.title).toBe(DEFAULT_CHAT_TITLE)
  })

  it('deletes a session and reports missing targets', () => {
    const session = createChatSession('2026-06-30T09:00:00.000Z')
    const otherSession = createChatSession('2026-06-30T09:05:00.000Z')

    expect(deleteChatSession([session, otherSession], session.id)).toEqual([otherSession])
    expect(() => renameChatSession([session], 'missing', 'Next title')).toThrow(
      'Cannot rename missing chat session: missing'
    )
    expect(() => deleteChatSession([session], 'missing')).toThrow(
      'Cannot delete missing chat session: missing'
    )
  })

  it('selects the next visible ask after deleting the first active session', () => {
    const turkeySession: ChatSession = {
      ...createChatSession('2026-07-30T03:27:59.106Z'),
      title: 'turkey'
    }
    const nextSession: ChatSession = {
      ...createChatSession('2026-08-12T14:49:15.553Z'),
      title: 'wind down'
    }
    const remainingSessions = deleteChatSession([turkeySession, nextSession], turkeySession.id)

    expect(
      getNextActiveChatSessionIdAfterDelete(
        remainingSessions,
        turkeySession.id,
        turkeySession.id
      )
    ).toBe(nextSession.id)
  })

  it('keeps the current ask selected when deleting a different session', () => {
    const activeSession = createChatSession('2026-08-12T14:49:15.553Z')
    const sessionToDelete = createChatSession('2026-07-30T03:27:59.106Z')
    const remainingSessions = deleteChatSession([sessionToDelete, activeSession], sessionToDelete.id)

    expect(
      getNextActiveChatSessionIdAfterDelete(
        remainingSessions,
        sessionToDelete.id,
        activeSession.id
      )
    ).toBe(activeSession.id)
  })

  it('confirms before deleting a session', () => {
    const session: ChatSession = {
      ...createChatSession('2026-06-30T09:00:00.000Z'),
      title: 'Grammar check'
    }
    const confirmationMessage = getDeleteChatSessionConfirmationMessage(session)
    const confirmDelete = (message: string): boolean => {
      expect(message).toBe(confirmationMessage)
      return false
    }

    expect(confirmationMessage).toContain('删除 "Grammar check"?')
    expect(confirmationMessage).toContain(ASK_DELETE_CONFIRMATION_DETAIL)
    expect(shouldDeleteChatSession(session, confirmDelete)).toBe(false)
  })
})
