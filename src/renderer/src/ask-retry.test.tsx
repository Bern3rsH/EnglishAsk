// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './App'
import { getRetryQuestion, INTERRUPTED_ASK_ERROR, type AskRequestState } from './ask-request-state'
import type { ChatMessage } from '../../shared/ai'

let root: Root
let host: HTMLDivElement
const askEnglish = vi.fn()
const HISTORY_KEY = 'english-ask:chat-history'
const question: ChatMessage = { id: 'q', role: 'user', content: 'Explain went.', createdAt: '2026-09-14' }
const failed: AskRequestState = { requestId: 'r', questionMessageId: 'q', status: 'settled', error: 'Timeout' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('englishAsk', { askEnglish, getSettings: vi.fn().mockResolvedValue({ ok: false, error: 'Test settings unavailable' }) })
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn()
  localStorage.clear()
  localStorage.setItem(HISTORY_KEY, JSON.stringify([{ id: 'session', title: '重试 test',
    createdAt: '2026-09-14', updatedAt: '2026-09-14', messages: [] }]))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function enterQuestion(text: string) {
  const input = host.querySelector('textarea[aria-label="问题"]')!
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('hides language settings, retains the Asks workspace and defaults new message metadata to Chinese', async () => {
  askEnglish.mockResolvedValue({ ok: true, data: { answer: '这是英文例句：I have worked here.', model: 'test' } })
  await act(() => root.render(<App />))
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(element => element.textContent?.trim() === text)!
  expect(button('Asks')).toBeDefined()
  await act(() => button('设置').click())
  const navigation = host.querySelector('[aria-label="设置分类"]')!
  expect(navigation.textContent).not.toContain('Asks')
  expect(host.querySelector('[aria-label="Default answer language"]')).toBeNull()
  expect(navigation.textContent).toContain('模型')
  expect(navigation.textContent).toContain('Notes')
  await act(() => button('返回').click())
  await enterQuestion('Please answer in English.')
  await act(() => host.querySelector('form.composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  const messages = JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0].messages
  expect(messages[1].answerLanguage).toBe('zh')
  expect(messages[1].content).toContain('I have worked here.')
})

it.each(['format', 'grammar'] as const)('retains %s fallback across reload and failed retries, replacing only the answer on success', async warningStage => {
  const output = JSON.stringify({ answer: 'Original explanation', sections: [
    { module: 'examples', content: 'Original example', examples: [{ english: 'I went home. 我回家了。' }] }
  ] })
  askEnglish.mockResolvedValueOnce({ ok: true, data: { answer: output, formatWarning: 'Validation failed', warningStage, model: 'test' } })
  await act(() => root.render(<App />))
  await enterQuestion('Explain went.')
  await act(() => host.querySelector('form.composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(host.textContent).toContain('Original explanation')
  expect(host.textContent).toContain('I went home. 我回家了。')
  expect(host.textContent).toContain(warningStage === 'grammar' ? '语法检查未完成，已保留原回答' : '已保留原内容')
  await act(() => root.unmount())
  root = createRoot(host)
  await act(() => root.render(<App />))
  const retry = () => host.querySelector<HTMLButtonElement>(warningStage === 'grammar'
    ? '[aria-label="重试语法检查"]' : '[aria-label="重试格式化回答"]')!
  expect(retry()).not.toBeNull()
  await enterQuestion('Keep my next draft')
  let finish!: (value: unknown) => void
  askEnglish.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(() => retry().click())
  expect(retry().disabled).toBe(true)
  expect(host.textContent).toContain('Original explanation')
  await act(() => finish({ ok: false, error: 'Network failed' }))
  expect(retry().disabled).toBe(false)
  expect(host.textContent).toContain('Original explanation')
  askEnglish.mockResolvedValueOnce({ ok: true, data: { answer: 'Corrected answer', model: 'test' } })
  await act(() => retry().click())
  expect(retry()).toBeNull()
  expect(host.textContent).toContain('Corrected answer')
  const messages = JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0].messages
  expect(messages.map((message: ChatMessage) => message.role)).toEqual(['user', 'assistant'])
  expect(messages[1].formatWarning).toBeUndefined()
  expect(askEnglish.mock.calls.every(([request]) => request.question === 'Explain went.' && request.history.length === 0)).toBe(true)
  expect(askEnglish.mock.calls[1][0].retryOfRequestId).toBe(askEnglish.mock.calls[0][0].requestId)
  expect((host.querySelector('textarea[aria-label="问题"]') as HTMLTextAreaElement).value).toBe('Keep my next draft')
})

it('retries an older unformatted answer with only its original context, preserving later messages', async () => {
  const messages = [
    question,
    { id: 'answer', role: 'assistant', content: 'Old answer', createdAt: '2026-09-14',
      formatWarning: 'Invalid format', retryQuestionMessageId: question.id },
    { ...question, id: 'later-q', content: 'A later question' },
    { id: 'later-a', role: 'assistant', content: 'A later answer', createdAt: '2026-09-14' }
  ]
  localStorage.setItem(HISTORY_KEY, JSON.stringify([{ id: 'session', title: 'Retry',
    createdAt: '2026-09-14', updatedAt: '2026-09-14', messages }]))
  askEnglish.mockResolvedValueOnce({ ok: true, data: { answer: 'Still unformatted', formatWarning: 'Invalid format', model: 'test' } })
  await act(() => root.render(<App />))
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label="重试格式化回答"]')!.click())
  expect(askEnglish.mock.calls[0][0]).toMatchObject({ question: question.content, history: [] })
  const saved = JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0].messages
  expect(saved).toHaveLength(4)
  expect(saved[1]).toMatchObject({ id: 'answer', content: 'Still unformatted', retryQuestionMessageId: question.id })
  expect(saved.slice(2)).toEqual(messages.slice(2))
  expect(host.querySelector('[aria-label="重试格式化回答"]')).not.toBeNull()
})

it('renders answer tags before the answer and restores them without Router diagnostics', async () => {
  askEnglish.mockResolvedValue({ ok: true, data: { answer: '正文', model: 'test', answerTags: ['单词', '解释含义'] } })
  await act(() => root.render(<App />))
  await enterQuestion('test')
  await act(() => host.querySelector('form.composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  const tags = host.querySelector('[aria-label="回答标签"]')!
  expect(tags.textContent).toBe('#单词#解释含义')
  expect(tags.parentElement!.firstElementChild).toBe(tags)
  expect(JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0].messages[1].answerTags).toEqual(['单词', '解释含义'])
  await act(() => root.unmount())
  root = createRoot(host)
  await act(() => root.render(<App />))
  expect(host.querySelector('[aria-label="回答标签"]')?.textContent).toBe('#单词#解释含义')
})

it('only retries the matching latest failed question, never cancellation or another question', () => {
  expect(getRetryQuestion(failed, [question])).toEqual(question)
  for (const status of ['pending', 'stopped'] as const) {
    expect(getRetryQuestion({ ...failed, status }, [question])).toBeUndefined()
  }
  expect(getRetryQuestion({ ...failed, error: null }, [question])).toBeUndefined()
  expect(getRetryQuestion(failed, [{ ...question, id: 'another' }])).toBeUndefined()
  expect(getRetryQuestion(failed, [question, { ...question, id: 'answer', role: 'assistant' }])).toBeUndefined()
  expect(getRetryQuestion(undefined, [question])).toBeUndefined()
})

it('reuses a failed question, preserves the draft and saves the actual response language', async () => {
  askEnglish.mockResolvedValueOnce({ ok: false, error: 'Review timed out.' })
    .mockResolvedValueOnce({ ok: false, error: '服务商 unavailable.' })
    .mockResolvedValueOnce({ ok: true, data: { answer: 'Went is the past tense of go.', model: 'test', answerLanguage: 'en' } })
  await act(() => root.render(<App />))
  await enterQuestion('Explain went. Please answer in English.')
  await act(() => host.querySelector('form.composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(host.textContent).toContain('Review timed out.')
  await enterQuestion('A draft for my next question')
  const retry = () => host.querySelector<HTMLButtonElement>('button[aria-label="重新回答"]')!
  await act(() => retry().click())
  expect(host.textContent).toContain('服务商 unavailable.')
  await act(() => retry().click())
  expect(retry()).toBeNull()
  expect((host.querySelector('textarea[aria-label="问题"]') as HTMLTextAreaElement).value).toBe('A draft for my next question')
  const calls = askEnglish.mock.calls.map(([request]) => request)
  expect(new Set(calls.map(request => request.requestId)).size).toBe(3)
  expect(calls[0].retryOfRequestId).toBeUndefined()
  expect(calls[1].retryOfRequestId).toBe(calls[0].requestId)
  expect(calls[2].retryOfRequestId).toBe(calls[1].requestId)
  expect(calls.every(request => request.question === calls[0].question && request.history.length === 0)).toBe(true)
  const messages = JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0].messages
  expect(messages.map((message: ChatMessage) => message.role)).toEqual(['user', 'assistant'])
  expect(messages[1].answerLanguage).toBe('en')
})

it('restores a failed request after remount and retries once without duplicating the question', async () => {
  askEnglish.mockResolvedValueOnce({ ok: false, error: 'Review timed out.' })
    .mockResolvedValueOnce({ ok: true, data: { answer: 'A recovered answer.', model: 'test' } })
  await act(() => root.render(<App />))
  await enterQuestion('Explain went.')
  await act(() => host.querySelector('form.composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  const failedSnapshot = JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0]
  expect(failedSnapshot.retryState.status).toBe('failed')
  const originalQuestionId = failedSnapshot.messages[0].id
  await act(() => root.unmount())
  root = createRoot(host)
  await act(() => root.render(<App />))
  expect(host.textContent).toContain('Review timed out.')
  expect(askEnglish).toHaveBeenCalledTimes(1)
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label="重新回答"]')!.click())
  expect(askEnglish.mock.calls[1][0].retryOfRequestId).toBe(failedSnapshot.retryState.requestId)
  const recovered = JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0]
  expect(recovered.retryState).toBeUndefined()
  expect(recovered.messages.map((message: ChatMessage) => message.role)).toEqual(['user', 'assistant'])
  expect(recovered.messages[0].id).toBe(originalQuestionId)
  await act(() => root.unmount())
  root = createRoot(host)
  await act(() => root.render(<App />))
  expect(host.querySelector('[aria-label="重新回答"]')).toBeNull()
  expect(host.textContent).toContain('A recovered answer.')
})

it('restores interrupted pending requests as manual retry, never permanent Thinking or auto submission', async () => {
  const session = JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0]
  session.messages = [question]
  session.retryState = { requestId: 'interrupted', questionMessageId: question.id, status: 'pending' }
  localStorage.setItem(HISTORY_KEY, JSON.stringify([session]))
  await act(() => root.render(<App />))
  expect(host.textContent).toContain(INTERRUPTED_ASK_ERROR)
  expect(host.textContent).not.toContain('正在思考…')
  expect(host.querySelector('[aria-label="重新回答"]')).not.toBeNull()
  expect(askEnglish).not.toHaveBeenCalled()
})

it.each([
  { development: false, status: 'success' }, { development: false, status: 'error' },
  { development: true, status: 'success' }, { development: true, status: 'error' }
] as const)('limits live and restored $status classifier UI to development (DEV=$development)', async ({ development, status }) => {
  vi.stubEnv('DEV', development)
  const diagnostic = status === 'error' ? { status, message: 'Router unavailable' } : {
    status, classification: { inputType: 'word', structureType: 'single_word', targetText: 'test',
      targets: ['test'], focusText: '', intent: 'explain_meaning', modules: ['meaning'],
      confidence: 1, needsClarification: false, clarificationQuestion: '', responseMode: 'card' }
  }
  askEnglish.mockResolvedValue({ ok: true, data: { answer: '正常回答保持可见', model: 'test', routerDiagnostic: diagnostic } })
  await act(() => root.render(<App />))
  await enterQuestion('test')
  await act(() => host.querySelector('form.composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  const checkVisibility = () => {
    expect(Boolean(host.querySelector('[aria-label="分类诊断"]'))).toBe(development)
    expect(host.textContent).toContain('正常回答保持可见')
    expect(host.textContent).toContain('新建 Note')
    if (!development) {
      expect(host.textContent).not.toContain('Router unavailable')
      expect(host.querySelector('.routerDiagnosticDetails')).toBeNull()
    }
  }
  checkVisibility()
  expect(JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0].messages[1].routerDiagnostic).toBeDefined()
  await act(() => root.unmount())
  root = createRoot(host)
  await act(() => root.render(<App />))
  checkVisibility()
})

it.each(['success', 'error'] as const)('persists end-to-end timing at the end of %s diagnostics', async status => {
  let clock = 100
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  const diagnostic = status === 'error' ? { status, message: 'Router unavailable' } : {
    status, classification: { inputType: 'word', structureType: 'single_word', targetText: 'test',
      targets: ['test'], focusText: '', intent: 'explain_meaning', modules: ['meaning'],
      confidence: 1, needsClarification: false, clarificationQuestion: '', responseMode: 'card' }
  }
  askEnglish.mockImplementation(async () => {
    clock += 12_345
    return { ok: true, data: { answer: '回答', model: 'test', routerDiagnostic: diagnostic } }
  })
  await act(() => root.render(<App />))
  await enterQuestion('test')
  await act(() => host.querySelector('form.composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  const saved = JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0].messages
  expect(saved[1].responseDurationMs).toBe(12_345)
  const lastRow = () => host.querySelector('.routerDiagnosticDetails')!.lastElementChild!.textContent
  expect(lastRow()).toBe('总耗时12.35 秒')
  await act(() => root.unmount())
  clock += 999_999
  root = createRoot(host)
  await act(() => root.render(<App />))
  expect(lastRow()).toBe('总耗时12.35 秒')
  expect(askEnglish).toHaveBeenCalledTimes(1)
})

it('times a retry from the retry click, excluding the previous failure and idle interval', async () => {
  let clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  askEnglish.mockImplementationOnce(async () => {
    clock += 45_000
    return { ok: false, error: 'Timeout' }
  }).mockImplementationOnce(async () => {
    clock += 2500
    return { ok: true, data: { answer: 'Recovered', model: 'test' } }
  })
  await act(() => root.render(<App />))
  await enterQuestion('test')
  await act(() => host.querySelector('form.composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  clock += 60_000
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label="重新回答"]')!.click())
  expect(JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0].messages[1].responseDurationMs).toBe(2500)
})

it('keeps overlapping Asks timing independent', async () => {
  const sessions = JSON.parse(localStorage.getItem(HISTORY_KEY)!)
  sessions.push({ ...sessions[0], id: 'second', title: 'Second timing Ask', messages: [] })
  localStorage.setItem(HISTORY_KEY, JSON.stringify(sessions))
  let clock = 100
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  const finish: Array<(result: unknown) => void> = []
  askEnglish.mockImplementation(() => new Promise(resolve => finish.push(resolve)))
  await act(() => root.render(<App />))
  await enterQuestion('first')
  await act(() => host.querySelector('form.composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  clock = 500
  await act(() => [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent === 'Second timing Ask')!.click())
  await enterQuestion('second')
  await act(() => host.querySelector('form.composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  clock = 1100
  await act(() => finish[0]({ ok: true, data: { answer: 'First answer', model: 'test' } }))
  clock = 2100
  await act(() => finish[1]({ ok: true, data: { answer: 'Second answer', model: 'test' } }))
  const saved = JSON.parse(localStorage.getItem(HISTORY_KEY)!)
  expect(saved.find((session: { id: string }) => session.id === 'session').messages[1].responseDurationMs).toBe(1000)
  expect(saved.find((session: { id: string }) => session.id === 'second').messages[1].responseDurationMs).toBe(1600)
})

it('shows unrecorded duration for historical diagnostics without timing', async () => {
  const sessions = JSON.parse(localStorage.getItem(HISTORY_KEY)!)
  sessions[0].messages = [{ ...question, role: 'assistant', content: 'Historical answer',
    routerDiagnostic: { status: 'error', message: 'Old diagnostic' } }]
  localStorage.setItem(HISTORY_KEY, JSON.stringify(sessions))
  await act(() => root.render(<App />))
  expect(host.querySelector('.routerDiagnosticDetails')!.lastElementChild!.textContent).toBe('总耗时未记录')
  expect(askEnglish).not.toHaveBeenCalled()
})


it.each([
  [undefined, '未记录'],
  [{ source: 'rule' }, '否（本地规则）'],
  [{ source: 'original' }, '否（原分类器）'],
  [{ source: 'jev-assisted', channel: 'vercel' }, '是（已采用分类结果） · Vercel AI Gateway'],
  [{ source: 'jev-fallback', channel: 'openrouter' }, '已尝试，未采用（回退原分类器） · OpenRouter']
])('renders and restores actual Jev routing provenance: %j', async (routing, expected) => {
  askEnglish.mockResolvedValue({ ok: true, data: { answer: '回答', model: 'test', routerDiagnostic: {
    status: 'success', ...(routing ? { routing } : {}),
    classification: { inputType: 'word', structureType: 'single_word', targetText: 'test',
      targets: ['test'], focusText: '', intent: 'explain_meaning', modules: ['meaning'],
      confidence: 1, needsClarification: false, clarificationQuestion: '', responseMode: 'card' }
  } } })
  await act(() => root.render(<App />))
  await enterQuestion('test')
  await act(() => host.querySelector('form.composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  const row = () => host.querySelector('.routerDiagnosticDetails')!.firstElementChild!.textContent
  expect(row()).toBe(`使用 Jev${expected}`)
  await act(() => root.unmount())
  root = createRoot(host)
  await act(() => root.render(<App />))
  expect(row()).toBe(`使用 Jev${expected}`)
})
