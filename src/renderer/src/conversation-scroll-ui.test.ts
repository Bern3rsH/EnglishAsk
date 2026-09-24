import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appSourcePath = fileURLToPath(new URL('./App.tsx', import.meta.url))

describe('conversation scroll restoration wiring', () => {
  it('stores per-ask scroll positions and restores them during ask switches', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain(
      'const conversationScrollPositionsRef = useRef<Map<string, number>>(new Map())'
    )
    expect(appSource).toContain(
      'conversationScrollPositionsRef.current.set(activeSessionId, conversation.scrollTop)'
    )
    expect(appSource).toContain('getRestoredConversationScrollTop(')
    expect(appSource).toContain('saveActiveConversationScrollPosition()')
  })

  it('keeps smooth auto-scroll for new content separate from ask selection changes', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain('useLayoutEffect(() => {')
    expect(appSource).toContain('didRestoreConversationScrollRef.current = true')
    expect(appSource).toMatch(
      /useEffect\(\(\) => \{[^]*conversation\.scrollTo\(\{[^]*behavior:\s*'smooth'[^]*\}, \[messages\.length, isSending\]\)/m
    )
    expect(appSource).not.toContain('}, [activeSessionId, messages.length, isSending])')
    expect(appSource).not.toContain('}, [messages.length, askRequests])')
  })

  it('holds an overflowing completed turn at its originating question', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain('const pendingCompletedAnswerRef = useRef<')
    expect(appSource).toMatch(
      /pendingCompletedAnswerRef\.current = \{\s*messageId: assistantMessage\.id,\s*questionMessageId: userMessage\.id,\s*sessionId: targetSessionId/s
    )
    expect(appSource).toContain('messageElementRefs.current.get(pendingAnswer.questionMessageId)')
    expect(appSource).toContain('if (!conversation || !answer || !questionElement)')
    expect(appSource).toContain('getCompletedQuestionStartScrollTop({')
    expect(appSource).toContain('answerBottom: answerBounds.bottom')
    expect(appSource).toContain('questionTop: questionBounds.top')
    expect(appSource).toContain('conversation.scrollTop = questionStartScrollTop')
    expect(appSource).toContain(
      'conversationScrollPositionsRef.current.set(activeSessionId, questionStartScrollTop)'
    )
    expect(appSource).toContain('shouldFollowConversationScrollRef.current = false')
    expect(appSource).toContain('activeSessionIdRef.current === targetSessionId')
    expect(appSource).toMatch(
      /if \(\s*pendingAnswer\.sessionId !== activeSessionId \|\|\s*!shouldFollowConversationScrollRef\.current\s*\)/s
    )
  })
})
