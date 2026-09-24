import type { ChatMessage } from '../../shared/ai'
import type { ChatSession } from './chat-history'

const MAX_PERSISTED_REQUEST_ID_LENGTH = 128
const MAX_PERSISTED_ERROR_LENGTH = 1000
export const INTERRUPTED_ASK_ERROR = '请求已中断，请重试以获取回答。'

export interface PersistedAskRequest {
  requestId: string
  questionMessageId: string
  status: 'pending' | 'failed'
  error?: string
}

export const normalizePersistedAskRequest = (value: unknown, messages: readonly ChatMessage[]): PersistedAskRequest | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<PersistedAskRequest>
  const last = messages.at(-1)
  if (typeof candidate.requestId !== 'string' || !candidate.requestId.trim() ||
    candidate.requestId.length > MAX_PERSISTED_REQUEST_ID_LENGTH ||
    last?.role !== 'user' || candidate.questionMessageId !== last.id ||
    (candidate.status !== 'pending' && candidate.status !== 'failed')) return undefined
  if (candidate.status === 'failed' && (typeof candidate.error !== 'string' || !candidate.error.trim())) return undefined
  return { requestId: candidate.requestId.trim(), questionMessageId: last.id, status: candidate.status,
    ...(candidate.status === 'failed' ? { error: candidate.error!.slice(0, MAX_PERSISTED_ERROR_LENGTH) } : {}) }
}

export const restoreAskRequests = (sessions: readonly ChatSession[]): AskRequestsState => {
  const requests = new Map<string, AskRequestState>()
  for (const session of sessions) {
    const stored = normalizePersistedAskRequest(session.retryState, session.messages)
    if (stored) requests.set(session.id, { requestId: stored.requestId, questionMessageId: stored.questionMessageId,
      status: 'settled', error: stored.status === 'pending' ? INTERRUPTED_ASK_ERROR : stored.error! })
  }
  return requests
}

export const persistAskRequests = (sessions: readonly ChatSession[], requests: AskRequestsState): ChatSession[] =>
  sessions.map(session => {
    const { retryState: previous, ...clean } = session
    const request = requests.get(session.id)
    const retryState = request && (request.status === 'pending' || (request.status === 'settled' && request.error))
      ? normalizePersistedAskRequest({ ...request, status: request.status === 'pending' ? 'pending' : 'failed' }, session.messages)
      : undefined
    return retryState ? { ...clean, retryState } : clean
  })

export interface AskRequestState {
  requestId: string
  questionMessageId?: string
  status: 'pending' | 'stopped' | 'settled'
  error: string | null
}

export type AskRequestsState = ReadonlyMap<string, AskRequestState>

export type AskRequestAction =
  | { type: 'start'; sessionId: string; requestId: string; questionMessageId?: string }
  | { type: 'complete'; sessionId: string; requestId: string; error?: string }
  | { type: 'stop'; sessionId: string; requestId: string }
  | { type: 'cancelFailed'; sessionId: string; requestId: string; error: string }
  | { type: 'remove'; sessionId: string }

export const isCurrentAskRequest = (
  state: AskRequestsState,
  sessionId: string,
  requestId: string
): boolean => {
  const request = state.get(sessionId)
  return request?.status === 'pending' && request.requestId === requestId
}

export const getRetryQuestion = (
  request: AskRequestState | undefined,
  messages: readonly ChatMessage[]
): ChatMessage | undefined => {
  const message = messages.at(-1)
  return request?.status === 'settled' && request.error &&
    message?.role === 'user' && message.id === request.questionMessageId
    ? message : undefined
}

export const reduceAskRequestState = (
  state: AskRequestsState,
  action: AskRequestAction
): AskRequestsState => {
  const request = state.get(action.sessionId)

  if (action.type === 'remove') {
    if (!request || request.status === 'pending') {
      return state
    }

    const nextState = new Map(state)
    nextState.delete(action.sessionId)
    return nextState
  }

  let nextRequest: AskRequestState

  if (action.type === 'start') {
    if (request?.status === 'pending') {
      return state
    }

    nextRequest = { requestId: action.requestId, status: 'pending', error: null }
    if (action.questionMessageId) nextRequest.questionMessageId = action.questionMessageId
  } else {
    if (!request || request.requestId !== action.requestId) {
      return state
    }

    if (action.type === 'cancelFailed') {
      if (request.status !== 'stopped') {
        return state
      }

      nextRequest = { ...request, error: action.error }
    } else {
      if (request.status !== 'pending') {
        return state
      }

      nextRequest = {
        ...request,
        status: action.type === 'stop' ? 'stopped' : 'settled',
        error: action.type === 'complete' ? action.error ?? null : null
      }
    }
  }

  const nextState = new Map(state)
  nextState.set(action.sessionId, nextRequest)
  return nextState
}
