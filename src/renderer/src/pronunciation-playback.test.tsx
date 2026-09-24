// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../shared/ai'
import { App } from './App'

let root: Root
let host: HTMLDivElement
const speech = { cancel: vi.fn(), speak: vi.fn(), getVoices: () => [] }
class TestUtterance {
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly text: string) {}
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('SpeechSynthesisUtterance', TestUtterance)
  vi.stubGlobal('speechSynthesis', speech)
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn()
  localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  localStorage.clear()
  vi.unstubAllGlobals()
})

async function renderMessage(message: ChatMessage) {
  localStorage.setItem('english-ask:chat-history', JSON.stringify([{
    id: 'test-session', title: 'Comparison', createdAt: '2026-09-13', updatedAt: '2026-09-13', messages: [message]
  }]))
  await act(() => root.render(<App />))
}

const comparison: ChatMessage = {
  id: 'test-message', role: 'assistant', content: 'A comparison.', createdAt: '2026-09-13',
  knowledgeCard: { cardType: 'comparison', targetText: 'say vs tell 的区别', targets: ['say', 'tell'],
    answer: 'A comparison.', sections: [{ module: 'comparison', content: 'Different usage.' }] }
}

it('plays each comparison separately and stops only the selected target', async () => {
  await renderMessage(comparison)
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('.messagePronunciation button')]
  expect(buttons).toHaveLength(2)
  await act(() => buttons[0].click())
  const first = speech.speak.mock.calls[0][0] as TestUtterance
  expect(first.text).toBe('say')
  expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
  const staleFinish = first.onend!
  await act(() => buttons[1].click())
  expect(speech.speak.mock.calls[1][0].text).toBe('tell')
  await act(() => staleFinish())
  expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
  await act(() => buttons[1].click())
  expect(speech.speak).toHaveBeenCalledTimes(2)
  expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'false'])
})

it('does not render pronunciation controls for translation answers', async () => {
  await renderMessage({ ...comparison, knowledgeCard: { ...comparison.knowledgeCard!,
    sections: [{ module: 'translation', content: 'A translation.' }] } })
  expect(host.querySelector('.messagePronunciation')).toBeNull()
  expect(speech.speak).not.toHaveBeenCalled()
})
