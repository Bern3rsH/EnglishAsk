import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appSourcePath = fileURLToPath(new URL('./App.tsx', import.meta.url))

describe('new item input focus wiring', () => {
  it('focuses the Ask composer for the exact newly created session', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain(
      'const pendingFocusedAskInputSessionIdRef = useRef<string | null>(null)'
    )
    expect(appSource).toContain('pendingFocusedAskInputSessionIdRef.current = nextSession.id')
    expect(appSource).toContain('pendingSessionId !== activeSessionId')
    expect(appSource).toContain("activeWorkspace !== 'asks'")
    expect(appSource).toContain('const questionInput = questionInputRef.current')
    expect(appSource).toContain('questionInput.focus()')
    expect(appSource).toMatch(
      /aria-label="问题"[^]*?placeholder="输入你想了解的英语问题"[^]*?ref=\{questionInputRef\}/
    )
    expect(appSource).not.toContain('historyItem.focus()')
    expect(appSource).not.toContain('pendingFocusedSessionIdRef')
  })

  it('focuses the new blank Note body after asynchronous creation and editor initialization', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain(
      'const pendingFocusedNoteInputIdRef = useRef<string | null>(null)'
    )
    expect(appSource).toMatch(
      /updateActiveNote\(result\.data\)\s*pendingFocusedNoteInputIdRef\.current = result\.data\.id\s*setRenamingNoteId\(null\)\s*setNoteRenameSurface\(null\)/
    )
    expect(appSource).toContain('pendingNoteId !== activeNoteId')
    expect(appSource).toContain('isLoadingNotes ||')
    expect(appSource).toContain("englishAskBridge.createNote({ markdown: '' })")
    expect(appSource).toMatch(/useEffect\(\(\) => \{\s*const pendingNoteId = pendingFocusedNoteInputIdRef.current/)
    expect(appSource).toMatch(/requestAnimationFrame\(\(\) => \{\s*if \(pendingFocusedNoteInputIdRef.current !== pendingNoteId[^]*?noteEditorRef.current.focus\(\)\s*pendingFocusedNoteInputIdRef.current = null/)
    expect(appSource).toContain('window.cancelAnimationFrame(animationFrameId)')
    expect(appSource).not.toContain('noteRenameInputRef')
  })

  it('shares focus behavior between toolbar and Cmd+N creation paths', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain('onClick={startNewAsk}')
    expect(appSource).toContain('void startNewNote()')
    expect(appSource).toMatch(/if \(activeWorkspace === 'asks'\) \{\s*startNewAsk\(\)/)
  })
})
