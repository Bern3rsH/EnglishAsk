import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Notes synchronization wiring', () => {
  it('refreshes visible windows periodically and on focus, and tears down all callbacks', async () => {
    const source = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
    expect(source).toContain('createNotesSynchronizer({')
    expect(source).toContain("document.visibilityState !== 'hidden'")
    expect(source).toContain('setInterval(refreshVisibleNotes, NOTES_SYNC_INTERVAL_MS)')
    expect(source).toContain("window.addEventListener('focus', refreshVisibleNotes)")
    expect(source).toContain("document.addEventListener('visibilitychange', refreshVisibleNotes)")
    expect(source).toContain('synchronizer.dispose()')
    expect(source).toContain('clearInterval(interval)')
    expect(source).toContain("window.removeEventListener('focus', refreshVisibleNotes)")
    expect(source).toContain("document.removeEventListener('visibilitychange', refreshVisibleNotes)")
    expect(source).toContain('}, [englishAskBridge, noteStorageRevision])')
  })

  it('protects local edits, pending saves, and local Note operations from background refresh', async () => {
    const source = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
    expect(source).toContain('isDirty: isNoteDirtyRef.current')
    expect(source).toContain('!notesSyncReadyRef.current')
    expect(source).toContain('noteSavesInFlightRef.current > 0')
    expect(source).toContain('revision: notesSyncRevisionRef.current')
    expect(source).toContain('const visibleNoteError = noteImageError ?? noteSyncError')
    expect(source).toContain('onDocument: updateActiveNote')
  })
})
