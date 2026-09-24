// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './App'
import type { CreateNoteRequest, FormatAskNoteRequest } from '../../shared/ai'
import { readNoteProvenance, withNoteProvenance, withoutNoteProvenance } from '../../shared/note-provenance'

vi.mock('./live-markdown-editor', () => ({
  LiveMarkdownEditor: ({ markdown, onChange }: { markdown: string; onChange: (body: string) => void }) => <div data-testid="editor">{markdown}<button onClick={() => onChange('Edited body')}>Edit test note</button></div>
}))
let root: Root
let host: HTMLDivElement
const planAskNotes = vi.fn()
const formatAskNote = vi.fn()
const createNote = vi.fn()
const messages = [
  { id: 'q', role: 'user', content: 'turkey 是什么意思', createdAt: '2026-09-24T10:00:00Z' },
  { id: 'a', role: 'assistant', content: 'turkey 表示火鸡。', createdAt: '2026-09-24T10:00:01Z' },
  { id: 'q2', role: 'user', content: '还有哪些用法？', createdAt: '2026-09-24T10:00:02Z' },
  { id: 'a2', role: 'assistant', content: '还可以比喻失败之作。', createdAt: '2026-09-24T10:00:03Z' }
]
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === text)!
  await act(() => button.click())
}
beforeEach(async () => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn()
  planAskNotes.mockResolvedValue({ ok: true, data: { topics: [
    { id: 'topic-1', title: 'turkey', messageIds: messages.map(message => message.id) }
  ] } })
  formatAskNote.mockResolvedValue({ ok: true, data: { title: 'turkey 的词义与用法', markdown: '## 含义\n\n火鸡；失败之作。' } })
  createNote.mockImplementation(async (request: CreateNoteRequest) => ({ ok: true, data: {
    id: `${request.name}.md`, title: request.name, markdown: request.markdown,
    createdAt: '2026-09-24', updatedAt: '2026-09-24'
  } }))
  vi.stubGlobal('englishAsk', {
    getSettings: vi.fn().mockResolvedValue({ ok: true, data: {
      modelProvider: 'openai', modelName: 'gpt-4.1', systemPrompt: 'Test', noteStorageDirectory: '/test/notes'
    } }),
    listNotes: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    planAskNotes, formatAskNote, createNote
  })
  localStorage.clear()
  localStorage.setItem('english-ask:chat-history', JSON.stringify([{
    id: 'ask', title: 'turkey 是什么意思', createdAt: '2026-09-24', updatedAt: '2026-09-24', messages
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
  vi.useRealTimers()
})

it('creates the file from the generated title and body including follow-ups', async () => {
  await click('新建 Note')
  expect(formatAskNote).toHaveBeenCalledExactlyOnceWith({ operation: 'create', askId: 'ask', messages })
  expect(createNote).toHaveBeenCalledExactlyOnceWith({ name: 'turkey 的词义与用法', markdown: '## 含义\n\n火鸡；失败之作。' })
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="当前 Note 标题"]')?.value).toBe('turkey 的词义与用法')
  expect(host.querySelector('[data-testid="editor"]')?.textContent).toContain('失败之作')
})

it('falls back to the question when the title is missing without losing the generated body', async () => {
  formatAskNote.mockResolvedValue({ ok: true, data: { markdown: 'Useful note content' } })
  await click('新建 Note')
  expect(createNote).toHaveBeenCalledWith({ name: 'turkey 是什么意思', markdown: 'Useful note content' })
})

it.each([false, true])('formats each selected message group correctly (combined: %s)', async combined => {
  planAskNotes.mockResolvedValue({ ok: true, data: { topics: [
    { id: 'first', title: 'Meaning', messageIds: ['q', 'a'] },
    { id: 'second', title: 'Usage', messageIds: ['q2', 'a2'] }
  ] } })
  formatAskNote.mockImplementation(async (request: FormatAskNoteRequest) => ({ ok: true, data: {
    title: request.messages.length === 4 ? 'Combined study' : `Study ${request.messages[0].id}`,
    markdown: 'Formatted content'
  } }))
  await click('新建 Note')
  expect(createNote).not.toHaveBeenCalled()
  await click(combined ? '合并所选主题' : '创建 2 个 Notes')
  expect(formatAskNote.mock.calls.map(([request]) => (request as FormatAskNoteRequest).messages.map(message => message.id)))
    .toEqual(combined ? [['q', 'a', 'q2', 'a2']] : [['q', 'a'], ['q2', 'a2']])
  expect(formatAskNote.mock.calls.every(([request]) => request.askId === 'ask')).toBe(true)
  expect(createNote.mock.calls.map(([request]) => request.name))
    .toEqual(combined ? ['Combined study'] : ['Study q', 'Study q2'])
})

it('does not create an empty note when content generation fails', async () => {
  formatAskNote.mockResolvedValue({ ok: false, error: 'Unable to format note.' })
  await click('新建 Note')
  expect(createNote).not.toHaveBeenCalled()
  expect(host.textContent).toContain('Unable to format note.')
})


it('hides managed metadata in the editor and retains it through an autosave', async () => {
  const metadata = { version: 1 as const, note_id: '18c8db31-71d6-48e8-a189-b41b4eb14033',
    sources: [{ ask_id: 'ask', message_ids: ['q', 'a', 'q2', 'a2'] }] }
  const markdown = withNoteProvenance('Learning content', metadata)
  formatAskNote.mockResolvedValue({ ok: true, data: { title: 'Study', markdown } })
  const save = vi.fn().mockImplementation(async request => ({ ok: true, data: {
    id: 'Study.md', title: 'Study', markdown: request.markdown, createdAt: '2026-09-24', updatedAt: '2026-09-24'
  } }))
  window.englishAsk!.saveNote = save
  await click('新建 Note')
  expect(host.querySelector('[data-testid="editor"]')?.textContent).toContain('Learning content')
  expect(host.querySelector('[data-testid="editor"]')?.textContent).not.toContain('english_ask')
  vi.useFakeTimers()
  await click('Edit test note')
  await act(() => vi.advanceTimersByTimeAsync(500))
  expect(save).toHaveBeenCalledTimes(1)
  expect(readNoteProvenance(save.mock.calls[0][0].markdown)).toEqual(metadata)
  expect(withoutNoteProvenance(save.mock.calls[0][0].markdown)).toBe('Edited body')
})
