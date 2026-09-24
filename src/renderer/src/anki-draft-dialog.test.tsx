// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AnkiDraftDialog } from './anki-draft-dialog'
import type { AnkiDraftSet } from '../../shared/anki'

const note = { id: 'Study.md', title: 'Study', markdown: 'Learning content', createdAt: '2026-09-24', updatedAt: '2026-09-24' }
const initialDrafts: AnkiDraftSet = { version: 1,
  sourceNoteId: '18c8db31-71d6-48e8-a189-b41b4eb14033', sourceRevision: 'a'.repeat(64), sourceTitle: 'Study', revision: 'generated',
  cards: [
    { id: 'card-1', front: 'Question one', back: 'Answer one', explanation: 'Context', tags: ['句型'], selected: true },
    { id: 'card-2', front: 'Question two', back: 'Answer two', explanation: '', tags: [], selected: true }
  ] }
let host: HTMLDivElement
let root: Root
const load = vi.fn()
const generate = vi.fn()
const save = vi.fn()
const close = vi.fn()
const exportCards = vi.fn()
const autosave = async () => { await act(() => vi.advanceTimersByTimeAsync(600)) }
const button = (text: string) => [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === text)!
const click = async (text: string) => { await act(() => button(text).click()) }
const render = async (strict = false, start = true) => {
  const dialog = <AnkiDraftDialog note={note} directory="/notes" onClose={close} />
  await act(() => root.render(strict ? <StrictMode>{dialog}</StrictMode> : dialog))
  if (start && button('生成卡片') && !button('生成卡片').disabled) await click('生成卡片')
}
const edit = async (label: string, value: string) => {
  const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!
  await act(() => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  load.mockResolvedValue({ ok: true, data: { drafts: null, stale: false } })
  generate.mockResolvedValue({ ok: true, data: structuredClone(initialDrafts) })
  save.mockImplementation(async request => ({ ok: true, data: { ...request.drafts, revision: 'saved' } }))
  exportCards.mockResolvedValue({ ok: true, data: { cancelled: false, count: 1, filePath: '/exports/cards.txt' } })
  vi.stubGlobal('englishAsk', { getSettings: vi.fn().mockResolvedValue({ ok: true, data: { modelProvider: 'deepseek', modelName: 'test-model', hasApiKey: true, providerSettings: { openai: { hasApiKey: true, modelName: 'gpt-4.1' } } } }), listProviderModels: vi.fn().mockResolvedValue({ ok: true, data: ['discovered-model'] }), saveSettings: vi.fn(), loadAnkiDrafts: load, generateAnkiDrafts: generate, saveAnkiDrafts: save, exportAnkiCards: exportCards })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('generates once in StrictMode, autosaves, and exposes export as the primary action', async () => {
  await render(true)
  expect(generate).toHaveBeenCalledTimes(1)
  expect(host.textContent).toContain('已选 2 / 2 张')
  expect(button('保存草稿')).toBeUndefined()
  expect(save).not.toHaveBeenCalled()
  await autosave()
  expect(save).toHaveBeenCalledTimes(1)
  expect(host.textContent).toContain('修改已自动保存')
})

it('flushes edited fields and selection before exporting the latest revision', async () => {
  await render()
  await edit('卡片 1 正面', '<script>Edited question</script>')
  await edit('卡片 1 背面', 'Edited answer')
  await edit('卡片 1 补充解释', 'Edited context')
  await edit('卡片 1 标签', '单词 usage')
  await act(() => host.querySelector<HTMLInputElement>('[aria-label="选择卡片 2"]')!.click())
  await click('预览卡片 1')
  expect(host.querySelector('.ankiCardPreview')?.textContent).toContain('<script>Edited question</script>')
  expect(host.querySelector('script')).toBeNull()
  await click('导出所选卡片')
  expect(save.mock.calls[0][0]).toMatchObject({ expectedDraftRevision: null, drafts: {
    cards: [{ front: '<script>Edited question</script>', back: 'Edited answer', explanation: 'Edited context', tags: ['单词', 'usage'], selected: true },
      { id: 'card-2', selected: false }]
  } })
  expect(exportCards).toHaveBeenCalledWith({ noteId: note.id, expectedMarkdown: note.markdown,
    expectedDirectory: '/notes', expectedDraftRevision: 'saved' })
  expect(host.textContent).toContain('已导出 1 张卡片')
  await click('关闭')
  expect(close).toHaveBeenCalledTimes(1)
})

it('restores saved drafts and autosaves edits with their revision', async () => {
  load.mockResolvedValue({ ok: true, data: { drafts: initialDrafts, stale: false } })
  await render()
  await autosave()
  expect(generate).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
  await edit('卡片 1 背面', 'Updated')
  await autosave()
  expect(save.mock.calls[0][0].expectedDraftRevision).toBe('generated')
})

it('flushes before Escape closes the dialog without requiring a save button', async () => {
  await render()
  await act(() => host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
  expect(save).toHaveBeenCalledTimes(1)
  expect(close).toHaveBeenCalledTimes(1)
})

it('keeps the dialog open on failed close, with explicit discard available', async () => {
  await render()
  save.mockResolvedValue({ ok: false, error: 'Disk full' })
  await click('关闭')
  expect(close).not.toHaveBeenCalled()
  expect(host.textContent).toContain('自动保存失败')
  await click('放弃修改并关闭')
  expect(close).toHaveBeenCalledTimes(1)
})

it('confirms regeneration and keeps manual edits if generation fails', async () => {
  await render()
  await edit('卡片 1 背面', 'Manual edit')
  await click('重新生成')
  expect(generate).toHaveBeenCalledTimes(1)
  generate.mockResolvedValue({ ok: false, error: 'Generation failed' })
  await click('确认重新生成')
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="卡片 1 背面"]')?.value).toBe('Manual edit')
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Generation failed')
})

it('blocks export on autosave failure and allows retry without losing edits', async () => {
  await render()
  save.mockResolvedValueOnce({ ok: false, error: 'Disk full' })
  await click('导出所选卡片')
  expect(exportCards).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Disk full')
  await click('重试自动保存')
  await click('导出所选卡片')
  expect(exportCards).toHaveBeenCalledTimes(1)
})

it('rejects incomplete answers and invalid tags before exporting', async () => {
  await render()
  await edit('卡片 1 背面', ' ')
  await click('导出所选卡片')
  expect(save).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('字段为空')
  await edit('卡片 1 背面', 'Answer')
  await edit('卡片 1 标签', Array.from({ length: 11 }, (_, index) => `tag${index}`).join(' '))
  await click('导出所选卡片')
  expect(exportCards).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('标签')
})

it('disables exporting stale drafts until regeneration', async () => {
  load.mockResolvedValue({ ok: true, data: { drafts: initialDrafts, stale: true } })
  await render()
  expect(host.textContent).toContain('Note 已更新')
  expect(button('导出所选卡片').disabled).toBe(true)
  await autosave()
  expect(save).not.toHaveBeenCalled()
  await click('重新生成')
  await click('确认重新生成')
  expect(button('导出所选卡片').disabled).toBe(false)
})

it('does not regenerate over unreadable drafts and can retry loading', async () => {
  load.mockResolvedValueOnce({ ok: false, error: 'Corrupt draft file' })
  await render()
  expect(generate).not.toHaveBeenCalled()
  await click('重试读取')
  expect(generate).not.toHaveBeenCalled()
  await click('生成卡片')
  expect(generate).toHaveBeenCalledTimes(1)
})

it('preserves newer typing while an autosave is in flight and exports only after it is saved', async () => {
  await render()
  let finish!: (value: unknown) => void
  save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await autosave()
  expect(save).toHaveBeenCalledTimes(1)
  await edit('卡片 1 背面', 'Latest edit while saving')
  await click('导出所选卡片')
  expect(exportCards).not.toHaveBeenCalled()
  await act(() => finish({ ok: true, data: { ...initialDrafts, revision: 'first-save' } }))
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls[1][0].expectedDraftRevision).toBe('first-save')
  expect(save.mock.calls[1][0].drafts.cards[0].back).toBe('Latest edit while saving')
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="卡片 1 背面"]')?.value).toBe('Latest edit while saving')
  expect(exportCards.mock.calls[0][0].expectedDraftRevision).toBe('saved')
})

it('prevents duplicate exports while the native save dialog is open', async () => {
  await render()
  let finish!: (value: unknown) => void
  exportCards.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await click('导出所选卡片')
  await click('导出所选卡片')
  expect(exportCards).toHaveBeenCalledTimes(1)
  await act(() => finish({ ok: true, data: { cancelled: true } }))
  expect(host.textContent).not.toContain('已导出')
  expect(button('导出所选卡片').disabled).toBe(false)
})

it('persists unchecked cards but disables exporting when nothing is selected', async () => {
  await render()
  await click('取消全选')
  expect(button('导出所选卡片').disabled).toBe(true)
  await autosave()
  expect(save.mock.calls[0][0].drafts.cards).toHaveLength(2)
  expect(save.mock.calls[0][0].drafts.cards.every((card: { selected: boolean }) => !card.selected)).toBe(true)
})

it('keeps saved cards after a file export error and can retry', async () => {
  await render()
  exportCards.mockResolvedValueOnce({ ok: false, error: 'Write failed' })
  await click('导出所选卡片')
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Write failed')
  await click('导出所选卡片')
  expect(exportCards).toHaveBeenCalledTimes(2)
  expect(save).toHaveBeenCalledTimes(1)
})


const select = async (label: string, value: string) => {
  await act(() => {
    const element = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!
    element.value = value
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
it('waits for explicit generation and sends the locally selected model without saving global settings', async () => {
  await render(true, false)
  expect(generate).not.toHaveBeenCalled()
  await select('制卡 Provider', 'openai')
  await click('刷新模型')
  await select('制卡模型', 'discovered-model')
  await select('制卡 Provider', 'deepseek')
  await select('制卡 Provider', 'openai')
  await click('生成卡片')
  expect(generate).toHaveBeenCalledTimes(1)
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ modelProvider: 'openai', modelName: 'discovered-model' }))
  expect(window.englishAsk!.saveSettings).not.toHaveBeenCalled()
})
it('shows an empty provider list without credentials while allowing saved cards to export', async () => {
  vi.mocked(window.englishAsk!.getSettings).mockResolvedValueOnce({ ok: true, data: { modelProvider: 'deepseek', modelName: 'test-model', hasApiKey: false } } as never)
  load.mockResolvedValue({ ok: true, data: { drafts: initialDrafts, stale: false } })
  await render(false, false)
  expect(host.querySelector<HTMLSelectElement>('[aria-label="制卡 Provider"]')!.disabled).toBe(true)
  expect(host.querySelector<HTMLSelectElement>('[aria-label="制卡 Provider"]')!.value).toBe('')
  expect(host.querySelector<HTMLSelectElement>('[aria-label="制卡模型"]')!.value).toBe('')
  expect(button('重新生成').disabled).toBe(true)
  expect(button('导出所选卡片').disabled).toBe(false)
  await click('导出所选卡片')
  expect(exportCards).toHaveBeenCalledTimes(1)
  expect(generate).not.toHaveBeenCalled()
})
it('retains selections and allows retry after model discovery fails', async () => {
  await render(false, false)
  vi.mocked(window.englishAsk!.listProviderModels).mockRejectedValueOnce(new Error('network'))
  await click('刷新模型')
  expect(host.textContent).toContain('无法刷新模型')
  expect(button('生成卡片').disabled).toBe(false)
  await click('刷新模型')
  expect(host.querySelector('[aria-label="制卡模型"]')!.textContent).toContain('discovered-model')
})


it('lists only credentialed providers and keeps the configured selection', async () => {
  await render(false, false)
  const provider = host.querySelector<HTMLSelectElement>('[aria-label="制卡 Provider"]')!
  expect([...provider.options].map(option => option.value)).toEqual(['openai', 'deepseek'])
  expect(provider.value).toBe('deepseek')
})

it('falls back to a credentialed provider when the global selection is unconfigured', async () => {
  vi.mocked(window.englishAsk!.getSettings).mockResolvedValueOnce({ ok: true, data: {
    modelProvider: 'deepseek', modelName: 'test-model', hasApiKey: false,
    providerSettings: { openai: { hasApiKey: true, apiKeySource: 'environment', modelName: 'gpt-4.1' } }
  } } as never)
  await render(false, false)
  const provider = host.querySelector<HTMLSelectElement>('[aria-label="制卡 Provider"]')!
  expect([...provider.options].map(option => option.value)).toEqual(['openai'])
  expect(provider.value).toBe('openai')
  await click('生成卡片')
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ modelProvider: 'openai', modelName: 'gpt-4.1' }))
  expect(window.englishAsk!.saveSettings).not.toHaveBeenCalled()
})
