// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './App'
import type { NoteDocument } from '../../shared/ai'
import { withNoteProvenance } from '../../shared/note-provenance'

vi.mock('./live-markdown-editor', () => ({ LiveMarkdownEditor: () => <div>Test editor</div> }))
let root: Root
let host: HTMLDivElement
let note: NoteDocument
const saveNote = vi.fn()
const formatAskNote = vi.fn()
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')]
  .find(element => element.textContent?.trim() === text)!
const click = async (text: string) => { await act(() => button(text).click()) }
beforeEach(async () => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn()
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  note = { id: 'Study.md', title: 'Study', markdown: 'My original note',
    createdAt: '2026-09-20', updatedAt: '2026-09-20' }
  formatAskNote.mockResolvedValue({ ok: true, data: { markdown: 'My merged note' } })
  saveNote.mockImplementation(async (request) => {
    if (request.expectedMarkdown !== undefined && note.markdown !== request.expectedMarkdown) {
      return { ok: false, error: '笔记内容已变更' }
    }
    note = { ...note, markdown: request.restorePrevious ? 'My original note' : request.markdown,
      canUndoUpdate: !request.restorePrevious }
    return { ok: true, data: note }
  })
  vi.stubGlobal('englishAsk', {
    getSettings: vi.fn().mockResolvedValue({ ok: true, data: {
      noteStorageDirectory: '/test/notes', modelProvider: 'deepseek', modelName: 'test',
      defaultAnswerLanguage: 'zh', systemPrompt: 'test' } }),
    listNotes: vi.fn().mockImplementation(async () => ({ ok: true, data: [note] })),
    getNote: vi.fn().mockImplementation(async () => ({ ok: true, data: { ...note } })),
    saveNote, formatAskNote
  })
  localStorage.clear()
  localStorage.setItem('english-ask:chat-history', JSON.stringify([{
    id: 'ask', title: 'Study', createdAt: '2026-09-20', updatedAt: '2026-09-20', messages: [
      { id: 'q', role: 'user', content: 'Explain went', createdAt: '2026-09-20' },
      { id: 'a', role: 'assistant', content: 'Went is past tense.', createdAt: '2026-09-20' }
    ]
  }]))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(() => root.render(<App />))
})
afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  localStorage.clear()
  vi.unstubAllGlobals()
})
async function preview() {
  await click('更新 Note')
  await click('生成更新预览')
}

it('previews both versions without saving and cancels without changing the note', async () => {
  await preview()
  expect(host.querySelector('dialog')?.textContent).toContain('My original note')
  expect(host.querySelector('dialog')?.textContent).toContain('My merged note')
  expect(saveNote).not.toHaveBeenCalled()
  await click('取消')
  expect(host.querySelector('dialog')).toBeNull()
  expect(note.markdown).toBe('My original note')
  expect(saveNote).not.toHaveBeenCalled()
})
it('confirms with the original snapshot and directory, then allows undo', async () => {
  await preview()
  await click('确认更新')
  expect(saveNote).toHaveBeenCalledWith({ id: 'Study.md', markdown: 'My merged note',
    expectedMarkdown: 'My original note', expectedDirectory: '/test/notes', preservePrevious: true })
  expect(host.querySelector('dialog')).toBeNull()
  await click('撤销上次更新')
  expect(saveNote).toHaveBeenLastCalledWith({ id: 'Study.md', restorePrevious: true,
    expectedMarkdown: 'My merged note', expectedDirectory: '/test/notes' })
  expect(note.markdown).toBe('My original note')
  expect(button('撤销上次更新')).toBeUndefined()
})
it('keeps a failed preview open and does not overwrite a later edit', async () => {
  await preview()
  note.markdown = 'External edit'
  await click('确认更新')
  expect(host.querySelector('dialog [role="alert"]')?.textContent).toContain('内容已变更')
  expect(note.markdown).toBe('External edit')
  expect(button('确认更新').disabled).toBe(false)
})
it('disables duplicate confirmation and cancellation while saving', async () => {
  await preview()
  let finish!: (value: unknown) => void
  saveNote.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await click('确认更新')
  expect(button('保存中…').disabled).toBe(true)
  expect(button('取消').disabled).toBe(true)
  await act(() => { host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })) })
  expect(host.querySelector('dialog')).not.toBeNull()
  await act(() => finish({ ok: false, error: 'Disk full' }))
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Disk full')
})
it('does not offer a save when the proposed content is unchanged', async () => {
  formatAskNote.mockResolvedValue({ ok: true, data: { markdown: note.markdown } })
  await preview()
  expect(button('确认更新').disabled).toBe(true)
  expect(host.querySelector('dialog')?.textContent).toContain('内容没有变化')
  expect(saveNote).not.toHaveBeenCalled()
})
it('supports Escape cancellation and blocks Cmd+N behind the preview', async () => {
  await preview()
  const history = localStorage.getItem('english-ask:chat-history')
  await act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true, bubbles: true })))
  expect(localStorage.getItem('english-ask:chat-history')).toBe(history)
  await act(() => host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
  expect(host.querySelector('dialog')).toBeNull()
  expect(saveNote).not.toHaveBeenCalled()
})


it('passes the real Ask identity and keeps provenance hidden in update previews', async () => {
  const metadata = { version: 1 as const, note_id: '18c8db31-71d6-48e8-a189-b41b4eb14033',
    sources: [{ ask_id: 'ask', message_ids: ['q', 'a'] }] }
  note.markdown = withNoteProvenance('My original note', metadata)
  formatAskNote.mockResolvedValue({ ok: true, data: { markdown: withNoteProvenance('New learning content', metadata) } })
  await preview()
  expect(formatAskNote).toHaveBeenCalledWith(expect.objectContaining({ askId: 'ask' }))
  expect(host.querySelector('dialog')?.textContent).toContain('New learning content')
  expect(host.querySelector('dialog')?.textContent).not.toContain('english_ask')
  expect(host.querySelector('dialog')?.textContent).not.toContain(metadata.note_id)
})
