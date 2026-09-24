import { describe, expect, it, vi } from 'vitest'
import type { NoteDocument, NoteDocumentResult, NotesListResult, NoteSummary } from '../../shared/ai'
import { createNotesSynchronizer, type NotesSyncSnapshot } from './notes-sync'

const note: NoteDocument = {
  id: 'A.md', title: 'A', markdown: 'Original', createdAt: '1', updatedAt: '1'
}
const otherNote: NoteDocument = { ...note, id: 'B.md', title: 'B', markdown: 'Other' }

const createHarness = () => {
  const snapshot: NotesSyncSnapshot = {
    activeNoteId: note.id, markdown: note.markdown, notes: [note],
    isDirty: false, isBusy: false, revision: 0
  }
  const dependencies = {
    getSnapshot: () => snapshot,
    listNotes: vi.fn<() => Promise<NotesListResult>>().mockResolvedValue({ ok: true, data: [note] }),
    getNote: vi.fn<(id: string) => Promise<NoteDocumentResult>>()
      .mockResolvedValue({ ok: true, data: note }),
    onNotes: vi.fn((notes: NoteSummary[]) => { snapshot.notes = notes }),
    onDocument: vi.fn((document: NoteDocument) => {
      snapshot.activeNoteId = document.id
      snapshot.markdown = document.markdown
      snapshot.revision += 1
    }),
    onEmpty: vi.fn(() => {
      snapshot.activeNoteId = null
      snapshot.markdown = ''
      snapshot.revision += 1
    }),
    onError: vi.fn()
  }
  return { snapshot, ...dependencies, synchronizer: createNotesSynchronizer(dependencies) }
}

describe('Notes 目录 synchronization', () => {
  it('adds external files without changing the selected Note or resetting identical content', async () => {
    const harness = createHarness()
    harness.listNotes.mockResolvedValue({ ok: true, data: [otherNote, note] })
    await harness.synchronizer.refresh()
    expect(harness.snapshot.notes.map((entry) => entry.id)).toEqual(['A.md', 'B.md'])
    expect(harness.onDocument).not.toHaveBeenCalled()
    harness.onNotes.mockClear()
    await harness.synchronizer.refresh()
    expect(harness.onNotes).not.toHaveBeenCalled()
  })

  it('reloads external content even if file timestamps are unchanged', async () => {
    const harness = createHarness()
    harness.getNote.mockResolvedValue({ ok: true, data: { ...note, markdown: '**Changed**' } })
    await harness.synchronizer.refresh()
    expect(harness.snapshot.markdown).toBe('**Changed**')
    expect(harness.onDocument).toHaveBeenCalledOnce()
  })

  it('switches to a remaining Note after deletion and clears the editor when none remain', async () => {
    const harness = createHarness()
    harness.listNotes.mockResolvedValue({ ok: true, data: [otherNote] })
    harness.getNote.mockResolvedValue({ ok: true, data: otherNote })
    await harness.synchronizer.refresh()
    expect(harness.snapshot.activeNoteId).toBe('B.md')
    harness.listNotes.mockResolvedValue({ ok: true, data: [] })
    await harness.synchronizer.refresh()
    expect(harness.snapshot.notes).toEqual([])
    expect(harness.snapshot.activeNoteId).toBeNull()
    expect(harness.snapshot.markdown).toBe('')
  })

  it('opens an externally added Note from an empty directory', async () => {
    const harness = createHarness()
    Object.assign(harness.snapshot, { activeNoteId: null, markdown: '', notes: [] })
    await harness.synchronizer.refresh()
    expect(harness.snapshot.activeNoteId).toBe(note.id)
    expect(harness.snapshot.markdown).toBe(note.markdown)
  })

  it('preserves unsaved Markdown while still updating other list entries', async () => {
    const harness = createHarness()
    Object.assign(harness.snapshot, { isDirty: true, markdown: 'Unsaved draft' })
    harness.listNotes.mockResolvedValue({ ok: true, data: [note, otherNote] })
    await harness.synchronizer.refresh()
    expect(harness.snapshot.notes).toHaveLength(2)
    expect(harness.getNote).not.toHaveBeenCalled()
    expect(harness.snapshot.markdown).toBe('Unsaved draft')
  })

  it('retains a reachable draft and warns if its file was deleted before saving', async () => {
    const harness = createHarness()
    Object.assign(harness.snapshot, { isDirty: true, markdown: 'Unsaved draft' })
    harness.listNotes.mockResolvedValue({ ok: true, data: [] })
    await harness.synchronizer.refresh()
    expect(harness.snapshot.notes).toEqual([note])
    expect(harness.onEmpty).not.toHaveBeenCalled()
    expect(harness.snapshot.markdown).toBe('Unsaved draft')
    expect(harness.onError).toHaveBeenCalledWith(expect.stringContaining('deleted outside'))
  })

  it('discards reads that complete after editing or changing the active selection', async () => {
    const harness = createHarness()
    let finishRead!: (result: NoteDocumentResult) => void
    harness.getNote.mockImplementation(() => new Promise((resolve) => { finishRead = resolve }))
    const refresh = harness.synchronizer.refresh()
    await vi.waitFor(() => expect(harness.getNote).toHaveBeenCalledOnce())
    Object.assign(harness.snapshot, { markdown: 'New draft', isDirty: true, revision: 1 })
    finishRead({ ok: true, data: { ...note, markdown: 'Stale disk content' } })
    await refresh
    expect(harness.onDocument).not.toHaveBeenCalled()
    expect(harness.onNotes).not.toHaveBeenCalled()
    expect(harness.snapshot.markdown).toBe('New draft')
  })

  it('serializes scans, skips local operations, and ignores responses after disposal', async () => {
    const harness = createHarness()
    harness.snapshot.isBusy = true
    await harness.synchronizer.refresh()
    expect(harness.listNotes).not.toHaveBeenCalled()
    harness.snapshot.isBusy = false
    let finishList!: (result: NotesListResult) => void
    harness.listNotes.mockImplementation(() => new Promise((resolve) => { finishList = resolve }))
    const refresh = harness.synchronizer.refresh()
    await harness.synchronizer.refresh()
    expect(harness.listNotes).toHaveBeenCalledOnce()
    harness.synchronizer.dispose()
    finishList({ ok: true, data: [] })
    await refresh
    expect(harness.onNotes).not.toHaveBeenCalled()
    expect(harness.onEmpty).not.toHaveBeenCalled()
  })

  it('ignores old-directory results even if the new directory has the same selected filename', async () => {
    const harness = createHarness()
    let finishList!: (result: NotesListResult) => void
    harness.listNotes.mockImplementation(() => new Promise((resolve) => { finishList = resolve }))
    const refresh = harness.synchronizer.refresh()
    harness.snapshot.revision += 1
    finishList({ ok: true, data: [] })
    await refresh
    expect(harness.onEmpty).not.toHaveBeenCalled()
    expect(harness.onNotes).not.toHaveBeenCalled()
  })

  it('keeps existing content on transient failures and recovers on the next scan', async () => {
    const harness = createHarness()
    harness.listNotes.mockRejectedValueOnce(new Error('Directory unavailable'))
    await harness.synchronizer.refresh()
    expect(harness.onError).toHaveBeenLastCalledWith('Directory unavailable')
    expect(harness.snapshot.markdown).toBe(note.markdown)
    harness.getNote.mockResolvedValueOnce({ ok: false, error: 'File changed during read' })
    await harness.synchronizer.refresh()
    expect(harness.onError).toHaveBeenLastCalledWith('File changed during read')
    await harness.synchronizer.refresh()
    expect(harness.onError).toHaveBeenLastCalledWith(null)
  })
})
