// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './App'
import type { NoteDocument } from '../../shared/ai'
import { withNoteProvenance, withoutNoteProvenance } from '../../shared/note-provenance'

vi.mock('./live-markdown-editor', () => ({ LiveMarkdownEditor: ({ markdown, onChange }: { markdown: string; onChange: (text: string) => void }) =>
  <div>{markdown}<button onClick={() => onChange('Latest handwritten knowledge')}>Edit Note for test</button></div> }))
const metadata = { version: 1 as const, note_id: '18c8db31-71d6-48e8-a189-b41b4eb14033', sources: [] }
let note: NoteDocument
let root: Root
let host: HTMLDivElement
const saveNote = vi.fn()
const generate = vi.fn()
const createNote = vi.fn()
const click = async (text: string) => {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === text)!
  await act(() => button.click())
}
beforeEach(async () => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn()
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  note = { id: 'Study.md', title: 'Study', markdown: withNoteProvenance('Original knowledge', metadata), createdAt: '2026-09-24', updatedAt: '2026-09-24' }
  saveNote.mockImplementation(async request => {
    note = { ...note, markdown: withNoteProvenance(request.markdown, metadata) }
    return { ok: true, data: note }
  })
  generate.mockResolvedValue({ ok: false, error: 'Test generation result' })
  vi.stubGlobal('englishAsk', {
    getSettings: vi.fn().mockResolvedValue({ ok: true, data: { modelProvider: 'deepseek', modelName: 'test', hasApiKey: true, noteStorageDirectory: '/notes' } }),
    listNotes: vi.fn().mockImplementation(async () => ({ ok: true, data: [note] })),
    getNote: vi.fn().mockImplementation(async () => ({ ok: true, data: note })),
    loadAnkiDrafts: vi.fn().mockResolvedValue({ ok: true, data: { drafts: null, stale: false } }),
    generateAnkiDrafts: generate, saveNote, createNote, captureTelemetryEvent: vi.fn()
  })
  localStorage.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(() => root.render(<App />))
  await click('Notes')
})
afterEach(async () => {
  await act(() => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals()
})

it('flushes unsaved Note edits before generating and blocks new-note shortcuts behind the dialog', async () => {
  await click('Edit Note for test')
  await click('生成 Anki 卡片')
  expect(saveNote).toHaveBeenCalledTimes(1)
  expect(generate).not.toHaveBeenCalled()
  await click('生成卡片')
  expect(withoutNoteProvenance(generate.mock.calls[0][0].expectedMarkdown)).toBe('Latest handwritten knowledge')
  expect(generate.mock.calls[0][0]).toMatchObject({ noteId: note.id, expectedDirectory: '/notes' })
  await act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true, bubbles: true })))
  expect(createNote).not.toHaveBeenCalled()
})

it('adds identity to a legacy Note through a guarded save before opening cards', async () => {
  note = { ...note, markdown: 'Legacy content' }
  await click('生成 Anki 卡片')
  expect(saveNote).toHaveBeenCalledWith({ id: note.id, markdown: 'Legacy content', expectedMarkdown: 'Legacy content', expectedDirectory: '/notes' })
  await click('生成卡片')
  expect(generate.mock.calls[0][0].expectedMarkdown).toContain(metadata.note_id)
})

it('keeps dirty Note content and does not generate when saving fails', async () => {
  saveNote.mockResolvedValue({ ok: false, error: 'Disk full' })
  await click('Edit Note for test')
  await click('生成 Anki 卡片')
  expect(generate).not.toHaveBeenCalled()
  expect(host.querySelector('dialog')).toBeNull()
  expect(host.textContent).toContain('Latest handwritten knowledge')
  expect(host.textContent).toContain('请先保存当前 Note')
})
