import { isJevChannel } from '../../shared/jev'
import { normalizePersistedAskRequest, type PersistedAskRequest } from './ask-request-state'
import { isAnswerTags } from '../../shared/answer-tags'
import {
  DEFAULT_ANSWER_LANGUAGE_OPTIONS,
  type ChatMessage,
  type DefaultAnswerLanguage
} from '../../shared/ai'
import {
  KNOWLEDGE_CARD_TYPES,
  type KnowledgeCard
} from '../../shared/knowledge-card'
import { parseCardExamples } from '../../shared/card-examples'
import {
  ROUTER_INPUT_TYPES,
  ROUTER_INTENTS,
  ROUTER_MODULES,
  ROUTER_RESPONSE_MODES,
  ROUTER_STRUCTURE_TYPES,
  type RouterClassification,
  type RouterDiagnostic
} from '../../shared/router'

export const DEFAULT_CHAT_TITLE = '新 Ask'
export const CHAT_TITLE_MAX_LENGTH = 48
export const ASK_DELETE_CONFIRMATION_DETAIL = '此 Ask 将从本地记录中删除。'

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
  retryState?: PersistedAskRequest
}

const createId = (): string => {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const normalizeTitle = (content: string): string => {
  const normalizedContent = content.replace(/\s+/g, ' ').trim()

  if (normalizedContent.length <= CHAT_TITLE_MAX_LENGTH) {
    return normalizedContent
  }

  return `${normalizedContent.slice(0, CHAT_TITLE_MAX_LENGTH - 1)}…`
}

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

const isRouterClassification = (value: unknown): value is RouterClassification => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<RouterClassification>

  return (
    ROUTER_INPUT_TYPES.includes(candidate.inputType as RouterClassification['inputType']) &&
    ROUTER_STRUCTURE_TYPES.includes(
      candidate.structureType as RouterClassification['structureType']
    ) &&
    typeof candidate.targetText === 'string' &&
    isStringArray(candidate.targets) &&
    typeof candidate.focusText === 'string' &&
    ROUTER_INTENTS.includes(candidate.intent as RouterClassification['intent']) &&
    ROUTER_RESPONSE_MODES.includes(
      candidate.responseMode as RouterClassification['responseMode']
    ) &&
    Array.isArray(candidate.modules) &&
    candidate.modules.every((module) =>
      ROUTER_MODULES.includes(module as RouterClassification['modules'][number])
    ) &&
    typeof candidate.confidence === 'number' &&
    Number.isFinite(candidate.confidence) &&
    typeof candidate.needsClarification === 'boolean' &&
    typeof candidate.clarificationQuestion === 'string'
  )
}

const isRouterDiagnostic = (value: unknown): value is RouterDiagnostic => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<RouterDiagnostic>
  if (candidate.routing !== undefined) {
    const routing = candidate.routing
    if (!routing || typeof routing !== 'object' ||
        !['rule', 'original', 'jev-assisted', 'jev-fallback'].includes(routing.source) ||
        (routing.channel !== undefined && !isJevChannel(routing.channel))) return false
  }

  if (candidate.status === 'error') {
    return typeof candidate.message === 'string'
  }

  return candidate.status === 'success' && isRouterClassification(candidate.classification)
}

const isKnowledgeCard = (value: unknown): value is KnowledgeCard => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<KnowledgeCard>

  return (
    KNOWLEDGE_CARD_TYPES.includes(candidate.cardType as KnowledgeCard['cardType']) &&
    typeof candidate.targetText === 'string' &&
    isStringArray(candidate.targets) &&
    typeof candidate.answer === 'string' &&
    Array.isArray(candidate.sections) &&
    candidate.sections.every((section) => {
      if (section && typeof section === 'object' && section.examples !== undefined) {
        try { parseCardExamples(section.examples) } catch { return false }
      }
      return (
        section !== null &&
        typeof section === 'object' &&
        ROUTER_MODULES.includes(section.module as KnowledgeCard['sections'][number]['module']) &&
        typeof section.content === 'string'
      )
    })
  )
}

const isAnswerLanguage = (value: unknown): value is DefaultAnswerLanguage => {
  return DEFAULT_ANSWER_LANGUAGE_OPTIONS.some((option) => option.id === value)
}

const isChatMessage = (value: unknown): value is ChatMessage => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ChatMessage>

  return (
    typeof candidate.id === 'string' &&
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    typeof candidate.createdAt === 'string' &&
    (candidate.answerTags === undefined || isAnswerTags(candidate.answerTags)) &&
    (candidate.formatWarning === undefined || typeof candidate.formatWarning === 'string') &&
    (candidate.warningStage === undefined || candidate.warningStage === 'format' || candidate.warningStage === 'grammar') &&
    (candidate.retryRequestId === undefined || typeof candidate.retryRequestId === 'string') &&
    (candidate.retryQuestionMessageId === undefined || typeof candidate.retryQuestionMessageId === 'string') &&
    (candidate.responseDurationMs === undefined ||
      (typeof candidate.responseDurationMs === 'number' &&
        Number.isFinite(candidate.responseDurationMs) && candidate.responseDurationMs >= 0)) &&
    (candidate.answerLanguage === undefined ||
      isAnswerLanguage(candidate.answerLanguage)) &&
    (candidate.routerDiagnostic === undefined ||
      isRouterDiagnostic(candidate.routerDiagnostic)) &&
    (candidate.knowledgeCard === undefined || isKnowledgeCard(candidate.knowledgeCard))
  )
}

const isChatSession = (value: unknown): value is ChatSession => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ChatSession>

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.messages) &&
    candidate.messages.every(isChatMessage) &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  )
}

export const createChatSession = (createdAt = new Date().toISOString()): ChatSession => {
  return {
    id: createId(),
    title: DEFAULT_CHAT_TITLE,
    messages: [],
    createdAt,
    updatedAt: createdAt
  }
}

export const getChatSessionTitle = (messages: ChatMessage[]): string => {
  const firstUsefulMessage = messages.find((message) => message.content.trim().length > 0)

  if (!firstUsefulMessage) {
    return DEFAULT_CHAT_TITLE
  }

  return normalizeTitle(firstUsefulMessage.content)
}

export const appendMessagesToSession = (
  sessions: ChatSession[],
  sessionId: string,
  messages: ChatMessage[]
): ChatSession[] => {
  const targetSession = sessions.find((session) => session.id === sessionId)

  if (!targetSession) {
    throw new Error(`Cannot update missing chat session: ${sessionId}`)
  }

  if (messages.length === 0) {
    return sessions
  }

  return sessions.map((session) => {
    if (session.id !== sessionId) {
      return session
    }

    const nextMessages = [...session.messages, ...messages]
    const lastMessage = nextMessages.at(-1)

    return {
      ...session,
      title: getChatSessionTitle(nextMessages),
      messages: nextMessages,
      updatedAt: lastMessage?.createdAt ?? session.updatedAt
    }
  })
}

export const renameChatSession = (
  sessions: ChatSession[],
  sessionId: string,
  title: string,
  updatedAt = new Date().toISOString()
): ChatSession[] => {
  const targetSession = sessions.find((session) => session.id === sessionId)

  if (!targetSession) {
    throw new Error(`Cannot rename missing chat session: ${sessionId}`)
  }

  const normalizedTitle = normalizeTitle(title) || DEFAULT_CHAT_TITLE

  return sessions.map((session) => {
    if (session.id !== sessionId) {
      return session
    }

    return {
      ...session,
      title: normalizedTitle,
      updatedAt
    }
  })
}

export const deleteChatSession = (sessions: ChatSession[], sessionId: string): ChatSession[] => {
  const targetSession = sessions.find((session) => session.id === sessionId)

  if (!targetSession) {
    throw new Error(`Cannot delete missing chat session: ${sessionId}`)
  }

  return sessions.filter((session) => session.id !== sessionId)
}

export const getNextActiveChatSessionIdAfterDelete = (
  remainingSessions: ChatSession[],
  deletedSessionId: string,
  currentActiveSessionId: string | null
): string | null => {
  if (remainingSessions.length === 0) {
    return null
  }

  if (
    currentActiveSessionId !== null &&
    currentActiveSessionId !== deletedSessionId &&
    remainingSessions.some((session) => session.id === currentActiveSessionId)
  ) {
    return currentActiveSessionId
  }

  return sortChatSessionsByRecent(remainingSessions)[0]?.id ?? remainingSessions[0].id
}

export const getDeleteChatSessionConfirmationMessage = (session: ChatSession): string => {
  return `删除 "${session.title}"?\n\n${ASK_DELETE_CONFIRMATION_DETAIL}`
}

export const shouldDeleteChatSession = (
  session: ChatSession,
  confirmDelete: (message: string) => boolean
): boolean => {
  return confirmDelete(getDeleteChatSessionConfirmationMessage(session))
}

export const normalizeChatSessions = (value: unknown): ChatSession[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isChatSession).map(session => {
    const { retryState: stored, ...clean } = session
    const retryState = normalizePersistedAskRequest(stored, session.messages)
    return retryState ? { ...clean, retryState } : clean
  })
}

export const filterChatSessions = (sessions: ChatSession[], query: string): ChatSession[] => {
  const normalizedQuery = query.trim().toLowerCase()

  if (normalizedQuery.length === 0) {
    return sessions
  }

  return sessions.filter((session) => {
    return (
      session.title.toLowerCase().includes(normalizedQuery) ||
      session.messages.some((message) => message.content.toLowerCase().includes(normalizedQuery))
    )
  })
}

export const sortChatSessionsByRecent = (sessions: ChatSession[]): ChatSession[] => {
  return sessions
    .slice()
    .sort((firstSession, secondSession) => secondSession.updatedAt.localeCompare(firstSession.updatedAt))
}
