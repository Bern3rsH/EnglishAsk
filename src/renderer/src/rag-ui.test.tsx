// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './App'
import { normalizeChatSessions } from './chat-history'
import { isNoteAnswer } from '../../shared/rag'

vi.mock('./live-markdown-editor', () => ({ LiveMarkdownEditor: () => <div>Test editor</div> }))
let root: Root
let host: HTMLDivElement
const askEnglish = vi.fn()
const openNoteAnswerSource = vi.fn()
const cancelAskEnglish = vi.fn()
const HISTORY_KEY = 'english-ask:chat-history'
const source = { sourceId: 'S1', noteId: 'Study.md', noteIdentity: 'filename:Study.md', identityKind: 'filename',
  directoryScopeId: 'a'.repeat(64), sourceRevision: 'b'.repeat(64), sourceChunkId: 'c'.repeat(64),
  sectionIndex: 0, title: 'used to / 含义', text: 'used to 表示过去的习惯。', quote: 'used to 表示过去的习惯。' }
const noteAnswer = { status: 'answered', answer: '表示过去的习惯。[S1]', sources: [source], generationCalled: true,
  modelProvider: 'deepseek', model: 'test', retrievedChunkCount: 1, providedSourceCount: 1, omittedChunkCount: 0 }
const note = { id: 'Study.md', title: 'Study', markdown: '# used to\n## 含义\nused to 表示过去的习惯。',
  createdAt: '2026-10-11', updatedAt: '2026-10-11' }
beforeEach(async () => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn()
  askEnglish.mockResolvedValue({ ok: true, data: { answer: noteAnswer.answer, noteAnswer, model: 'test' } })
  openNoteAnswerSource.mockResolvedValue({ ok: true, data: note })
  cancelAskEnglish.mockResolvedValue({ ok: true, cancelled: true })
  vi.stubGlobal('englishAsk', { askEnglish, openNoteAnswerSource, cancelAskEnglish,
    getSettings: vi.fn().mockResolvedValue({ ok: true, data: {
      noteStorageDirectory: '/test/notes', modelProvider: 'deepseek', modelName: 'test',
      defaultAnswerLanguage: 'zh', systemPrompt: 'test' } }),
    listNotes: vi.fn().mockResolvedValue({ ok: true, data: [note] }),
    getNote: vi.fn().mockResolvedValue({ ok: true, data: note }) })
  localStorage.clear()
  localStorage.setItem(HISTORY_KEY, JSON.stringify([{ id: 'session', title: 'RAG test',
    createdAt: '2026-10-11', updatedAt: '2026-10-11', messages: [] }]))
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
const submit = async (text = 'used to 的含义？') => {
  const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="问题"]')!
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(() => host.querySelector('form.composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}

it('always uses automatic routing without mode controls or hints', async () => {
  expect(host.querySelector('.noteAnswerToggle')).toBeNull()
  expect(host.querySelector('.noteAnswerHint')).toBeNull()
  expect(host.textContent).not.toContain('笔记：自动')
  expect(host.textContent).not.toContain('AI 自动判断是否需要检索笔记')
  await submit('普通问题')
  expect(askEnglish.mock.calls[0][0].answerMode).toBe('auto')
  expect(JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0].messages[0].answerMode).toBe('auto')
  await submit()
  expect(askEnglish.mock.calls[1][0].answerMode).toBe('auto')
})

it('restores automatic request mode for retries and shows sources only when retrieval occurred', async () => {
  askEnglish.mockResolvedValueOnce({ ok: false, error: '自动判断失败' })
  await submit('我的笔记中的例句？')
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label="重新回答"]')!.click())
  expect(askEnglish.mock.calls.map(([request]) => request.answerMode)).toEqual(['auto', 'auto'])
  expect(host.querySelector('[aria-label="笔记回答来源"]')).not.toBeNull()
})

it('shows an ordinary automatic answer without a Notes source footer', async () => {
  askEnglish.mockResolvedValueOnce({ ok: true, data: { answer: '普通英语解释。', model: 'test' } })
  await submit('hello 是什么意思？')
  expect(askEnglish.mock.calls[0][0].answerMode).toBe('auto')
  expect(host.querySelector('[aria-label="笔记回答来源"]')).toBeNull()
  expect(host.textContent).toContain('普通英语解释。')
})

it('persists automatic question mode, Notes answer and source excerpts across remounts', async () => {
  await submit()
  const messages = JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0].messages
  expect(messages[0].answerMode).toBe('auto')
  expect(messages[1].noteAnswer).toEqual(noteAnswer)
  await act(() => root.unmount())
  root = createRoot(host)
  await act(() => root.render(<App />))
  expect(host.querySelector('[aria-label="笔记回答来源"]')!.textContent).toContain(source.quote)
  expect(askEnglish).toHaveBeenCalledOnce()
})

it('renders Markdown headings, emphasis and separately numbered bilingual examples in Notes answers', async () => {
  const answer = '## 例句\n\n**draw attention to** 的例句：\n\n1. The article draws attention to the dangers.\n   这篇文章引起关注。[S1]\n\n2. She drew attention to the deadline.\n   她提醒大家注意截止日期。[S1]'
  askEnglish.mockResolvedValue({ ok: true, data: { answer, noteAnswer: { ...noteAnswer, answer }, model: 'test' } })
  await submit()
  const message = host.querySelector('.message-assistant')!
  expect(message.querySelector('h2')?.textContent).toBe('例句')
  expect(message.querySelector('strong')?.textContent).toBe('draw attention to')
  const items = message.querySelectorAll('ol > li')
  expect(items).toHaveLength(2)
  expect(items[0].textContent).toContain('这篇文章引起关注。[S1]')
  expect(items[1].textContent).toContain('她提醒大家注意截止日期。[S1]')
  expect(items[0].textContent).toContain('dangers.\n这篇文章')
})

it('opens source Notes through the validated bridge and navigates to Notes', async () => {
  await submit()
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label^="打开来源 S1"]')!.click())
  expect(openNoteAnswerSource).toHaveBeenCalledWith(source)
  expect(host.querySelector('[aria-label="Notes 工作区"]')).not.toBeNull()
})

it('keeps the answer visible and shows source failures without navigating away', async () => {
  await submit()
  openNoteAnswerSource.mockResolvedValue({ ok: false, error: '笔记内容已更新，请重新提问。' })
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label^="打开来源 S1"]')!.click())
  expect(host.textContent).toContain(noteAnswer.answer)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('内容已更新')
})

it('preserves historical Notes retries while new questions use automatic routing', async () => {
  await act(() => root.unmount())
  const session = JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0]
  session.messages = [{ id: 'legacy-question', role: 'user', content: 'used to 的含义？',
    createdAt: '2026-10-11', answerMode: 'notes' }]
  session.retryState = { requestId: 'legacy-request', questionMessageId: 'legacy-question',
    status: 'failed', error: '模型失败' }
  localStorage.setItem(HISTORY_KEY, JSON.stringify([session]))
  root = createRoot(host)
  await act(() => root.render(<App />))
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label="重新回答"]')!.click())
  await submit('新的问题')
  expect(askEnglish.mock.calls.map(([request]) => request.answerMode)).toEqual(['notes', 'auto'])
})

it('uses the existing stop action and discards late Notes answers', async () => {
  let finish!: (value: unknown) => void
  askEnglish.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await submit()
  expect(askEnglish.mock.calls[0][0].answerMode).toBe('auto')
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label="停止回答"]')!.click())
  expect(cancelAskEnglish).toHaveBeenCalledWith({ requestId: askEnglish.mock.calls[0][0].requestId })
  await act(() => finish({ ok: true, data: { answer: noteAnswer.answer, noteAnswer, model: 'test' } }))
  expect(JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0].messages).toHaveLength(1)
})

it('retains an explicit no-evidence response without rendering source buttons', async () => {
  const empty = { status: 'no_evidence', answer: '没有找到匹配的笔记片段。', sources: [], generationCalled: false,
    retrievedChunkCount: 0, providedSourceCount: 0, omittedChunkCount: 0 }
  askEnglish.mockResolvedValue({ ok: true, data: { answer: empty.answer, noteAnswer: empty, model: '' } })
  await submit()
  expect(host.textContent).toContain(empty.answer)
  expect(host.querySelector('[aria-label^="打开来源"]')).toBeNull()
})

it('strips corrupt source metadata from history while preserving the answer text', () => {
  expect(isNoteAnswer(noteAnswer)).toBe(true)
  const session = JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0]
  session.messages = [{ id: 'a', role: 'assistant', content: noteAnswer.answer, createdAt: '2026-10-11',
    noteAnswer: { ...noteAnswer, sources: [{ ...source, noteId: '../outside.md' }] } }]
  const restored = normalizeChatSessions([session])[0].messages[0]
  expect(restored.content).toBe(noteAnswer.answer)
  expect(restored.noteAnswer).toBeUndefined()
})
