import { expect, it } from 'vitest'
import { normalizeChatSessions, type ChatSession } from './chat-history'
import { persistAskRequests, restoreAskRequests, type AskRequestState } from './ask-request-state'

const session: ChatSession = { id: 'ask-a', title: 'A', createdAt: '2026-09-14', updatedAt: '2026-09-14',
  messages: [{ id: 'question-a', role: 'user', content: 'rain', createdAt: '2026-09-14' }] }
const failed: AskRequestState = { requestId: 'request-a', questionMessageId: 'question-a', status: 'settled', error: 'Timeout' }

it('round trips failure per session while leaving legacy history unchanged', () => {
  const other = { ...session, id: 'ask-b', messages: [{ ...session.messages[0], id: 'question-b' }] }
  const saved = persistAskRequests([session, other], new Map([[session.id, failed]]))
  const loaded = normalizeChatSessions(JSON.parse(JSON.stringify(saved)))
  expect(restoreAskRequests(loaded).get('ask-a')).toEqual(failed)
  expect(restoreAskRequests(loaded).has('ask-b')).toBe(false)
  expect(loaded[1]).toEqual(other)
  expect(normalizeChatSessions([session])).toEqual([session])
})

it.each([null, {}, { status: 'failed', requestId: 1 },
  { status: 'failed', requestId: 'r', questionMessageId: 'other', error: 'Timeout' },
  { status: 'failed', requestId: 'r', questionMessageId: 'question-a', error: 42 },
  { status: 'pending', requestId: 'x'.repeat(129), questionMessageId: 'question-a' }
])('drops malformed metadata without losing the conversation: %j', retryState => {
  expect(normalizeChatSessions([{ ...session, retryState }])).toEqual([session])
})

it('clears metadata after success, cancellation, removal or a different latest message', () => {
  const persisted = persistAskRequests([session], new Map([[session.id, failed]]))
  for (const state of [{ ...failed, error: null }, { ...failed, status: 'stopped' as const }]) {
    expect(persistAskRequests(persisted, new Map([[session.id, state]]))[0].retryState).toBeUndefined()
  }
  expect(persistAskRequests([], new Map([[session.id, failed]]))).toEqual([])
  const next = { ...persisted[0], messages: [...session.messages, { ...session.messages[0], id: 'new-question' }] }
  expect(persistAskRequests([next], new Map([[session.id, failed]]))[0].retryState).toBeUndefined()
  expect(restoreAskRequests([next]).size).toBe(0)
  expect(restoreAskRequests([{ ...persisted[0], messages: [...session.messages,
    { ...session.messages[0], id: 'answer', role: 'assistant' }] }]).size).toBe(0)
})

it('bounds persisted errors and stores no extra payload', () => {
  const saved = persistAskRequests([session], new Map([[session.id, { ...failed, error: 'x'.repeat(2000) }]]))
  expect(saved[0].retryState?.error).toHaveLength(1000)
  expect(Object.keys(saved[0].retryState!).sort()).toEqual(['error', 'questionMessageId', 'requestId', 'status'])
})
