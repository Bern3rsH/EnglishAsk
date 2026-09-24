// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './App'

let root: Root
let host: HTMLDivElement
const getSettings = vi.fn()
const listProviderModels = vi.fn()
const saveSettings = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('englishAsk', { getSettings, listProviderModels, saveSettings })
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
  vi.useRealTimers()
})

async function openSettings(modelName: string) {
  getSettings.mockResolvedValue({ ok: true, data: {
    modelProvider: 'deepseek', modelName, hasApiKey: true, apiKeySource: 'app', systemPrompt: '',
    hasGeminiApiKey: false, noteStorageSource: 'default', noteStoragePath: '/tmp/test-notes'
  } })
  await act(() => root.render(<App />))
  await act(() => [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent === '设置')!.click())
}

async function openModelMenu() {
  await act(() => host.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="模型"]')!.click())
  return [...document.querySelectorAll<HTMLElement>('[role="listbox"][aria-label="模型"] [role="option"]')]
}

it.each(['deepseek-v4-flash', 'custom-deepseek-model'])('lists saved model %s once and marks only one selected option', async model => {
  await openSettings(model)
  const options = await openModelMenu()
  expect(options.filter(option => option.textContent === model)).toHaveLength(1)
  expect(options.filter(option => option.getAttribute('aria-selected') === 'true')).toHaveLength(1)
  expect(options.map(option => option.textContent)).toEqual([...new Set([model, 'deepseek-v4-flash', 'deepseek-v4-pro'])])
})

it('deduplicates refreshed models while preserving selection', async () => {
  await openSettings('deepseek-v4-flash')
  listProviderModels.mockResolvedValue({ ok: true, data: ['deepseek-v4-flash', 'deepseek-v4-flash', 'deepseek-v4-pro'] })
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label="刷新模型列表"]')!.click())
  const options = await openModelMenu()
  expect(options.map(option => option.textContent)).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
  expect(options.filter(option => option.getAttribute('aria-selected') === 'true')).toHaveLength(1)
})

it('dismisses save success after three seconds, resets the timer on another save and retains errors', async () => {
  vi.useFakeTimers()
  await openSettings('deepseek-v4-flash')
  saveSettings.mockResolvedValue(await getSettings())
  const save = () => host.querySelector('form.settingsForm')!.dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }))
  await act(() => { save() })
  expect(host.textContent).toContain('设置已保存。')
  await act(() => vi.advanceTimersByTime(2000))
  expect(host.textContent).toContain('设置已保存。')
  await act(() => { save() })
  await act(() => vi.advanceTimersByTime(2000))
  expect(host.textContent).toContain('设置已保存。')
  await act(() => vi.advanceTimersByTime(1000))
  expect(host.textContent).not.toContain('设置已保存。')
  await act(() => { save() })
  await act(() => vi.advanceTimersByTime(1000))
  saveSettings.mockResolvedValue({ ok: false, error: '保存失败，请重试。' })
  await act(() => { save() })
  await act(() => vi.advanceTimersByTime(5000))
  expect(host.textContent).toContain('保存失败，请重试。')
})
