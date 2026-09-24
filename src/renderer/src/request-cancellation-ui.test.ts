import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appSourcePath = fileURLToPath(new URL('./App.tsx', import.meta.url))
const preloadSourcePath = fileURLToPath(new URL('../../preload/index.ts', import.meta.url))

describe('Ask request cancellation UI', () => {
  it('replaces 发送 with a stop action while a request is active', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain('{isSending ? (')
    expect(appSource).toContain('aria-label="停止回答"')
    expect(appSource).toContain('<StopIcon />')
    expect(appSource).toContain('void stopCurrentRequest()')
  })

  it('cancels by request ID and ignores a stopped request result', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')
    const preloadSource = await readFile(preloadSourcePath, 'utf8')

    expect(appSource).toContain("updateAskRequest({ type: 'start', requestId, sessionId: targetSessionId, questionMessageId: userMessage.id })")
    expect(appSource).toContain('!isCurrentAskRequest(askRequestsRef.current, targetSessionId, requestId)')
    expect(appSource).toContain("updateAskRequest({ type: 'stop', sessionId, requestId: activeRequest.requestId })")
    expect(appSource).toContain('const sessionId = activeSessionIdRef.current')
    expect(appSource).toContain('askRequestsRef.current.get(sessionId)')
    expect(appSource).toContain('englishAskBridge.cancelAskEnglish({')
    expect(preloadSource).toContain('ipcRenderer.invoke(CANCEL_ASK_ENGLISH_CHANNEL, request)')
  })

  it('scopes pending controls and errors to the visible Ask', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain('activeSession ? askRequests.get(activeSession.id) : undefined')
    expect(appSource).toContain("const isSending = activeAskRequest?.status === 'pending'")
    expect(appSource).toContain('const visibleError = error ?? activeAskRequest?.error')
    expect(appSource).toContain('askRequestsRef.current = nextState')
    expect(appSource).toContain("disabled={askRequests.get(historyContextMenu.sessionId)?.status === 'pending'}")
    expect(appSource).not.toContain('sendingSessionId')
    expect(appSource).not.toContain('activeAskRequestRef')
  })

  it('reads current history when confirming deletion so background answers are preserved', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain('chatSessionsRef.current = chatSessions')
    expect(appSource).toContain('deleteChatSession(chatSessionsRef.current, sessionId)')
    expect(appSource).toContain("updateAskRequest({ type: 'remove', sessionId })")
  })
})
