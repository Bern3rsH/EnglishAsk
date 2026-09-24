import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appSourcePath = fileURLToPath(new URL('./App.tsx', import.meta.url))

describe('workspace new-item shortcut wiring', () => {
  it('routes Cmd+N through the existing creation actions for the active workspace', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain('const handleNewItemShortcut = (event: globalThis.KeyboardEvent)')
    expect(appSource).toContain('!isNewItemShortcut(event)')
    expect(appSource).toContain("activeView !== 'chat'")
    expect(appSource).toContain('confirmationDialog !== null')
    expect(appSource).toMatch(
      /event\.preventDefault\(\)[^]*?if \(activeWorkspace === 'asks'\) \{\s*startNewAsk\(\)\s*return\s*\}[^]*?if \(!isLoadingNotes\) \{\s*void startNewNote\(\)/
    )
  })

  it('captures the shortcut from editors and removes the listener on cleanup', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain(
      "window.addEventListener('keydown', handleNewItemShortcut, true)"
    )
    expect(appSource).toContain(
      "window.removeEventListener('keydown', handleNewItemShortcut, true)"
    )
    expect(appSource).toContain(
      '[activeView, activeWorkspace, confirmationDialog, isLoadingNotes, startNewAsk, startNewNote, noteUpdatePreview, ankiSource, isOpeningAnki]'
    )
  })

  it('exposes the shortcut on both existing new-item controls', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toMatch(/aria-label="新建 Ask"[^]*?onClick=\{startNewAsk\}[^]*?title="新建 Ask（Cmd\+N）"/)
    expect(appSource).toMatch(/aria-label="新建 Note"[^]*?void startNewNote\(\)[^]*?title="新建 Note（Cmd\+N）"/)
  })
})
