// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './App'
import { ComposerModelMenu } from './composer-model-menu'
import type { ModelProvider, SaveSettingsRequest, SettingsState } from '../../shared/ai'

vi.mock('./live-markdown-editor', () => ({ LiveMarkdownEditor: () => <div /> }))

let root: Root
let host: HTMLDivElement
let settings: SettingsState
const saveSettings = vi.fn()
const listProviderModels = vi.fn()
const deleteProviderApiKey = vi.fn()
const query = <T extends Element>(selector: string): T => host.querySelector<T>(selector)!
const input = () => query<HTMLInputElement>('input[type="password"]')
const model = () => query<HTMLButtonElement>('[aria-label="模型"]')

async function clickText(text: string) {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === text)!
  await act(() => button.click())
}

async function selectProvider(label: string) {
  await act(() => query<HTMLButtonElement>('[aria-label="模型服务商"]').click())
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    .find(item => item.textContent?.trim() === label)!
  await act(() => option.click())
}

beforeEach(async () => {
  vi.resetAllMocks()
  vi.stubEnv('DEV', true)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn()
  localStorage.clear()
  settings = {
    modelProvider: 'openai', modelName: 'gpt-4.1-mini', hasApiKey: true, apiKeySource: 'app',
    hasGeminiApiKey: false, geminiModel: 'gemini-2.5-flash', defaultAnswerLanguage: 'zh',
    systemPrompt: 'Answer clearly.', noteStorageDirectory: '/test/notes', noteStorageSource: 'default',
    providerSettings: {
      openai: { hasApiKey: true, apiKeySource: 'app', modelName: 'gpt-4.1-mini' },
      deepseek: { hasApiKey: true, apiKeySource: 'app', modelName: 'saved-custom-model' },
      openrouter: { hasApiKey: true, apiKeySource: 'environment', modelName: 'openai/gpt-4.1' },
      anthropic: { hasApiKey: true, apiKeySource: 'app', modelName: 'claude-sonnet-5' },
      'google-gemini': { hasApiKey: false, apiKeySource: 'missing', modelName: 'gemini-2.5-flash' }
    }
  }
  saveSettings.mockImplementation(async (request: SaveSettingsRequest) => {
    const channel = request.jevChannel ?? settings.jevChannel ?? 'openrouter'
    const channelKeys = { ...settings.jevChannelKeys,
      [channel]: request.removeJevApiKey ? false : Boolean(request.jevApiKey || settings.jevChannelKeys?.[channel]) }
    settings = { ...settings, modelProvider: request.modelProvider, modelName: request.modelName,
      jevChannel: channel, jevChannelKeys: channelKeys,
      jevCloudflareAccountId: request.jevCloudflareAccountId ?? settings.jevCloudflareAccountId,
      jevRoutingEnabled: request.jevRoutingEnabled ?? settings.jevRoutingEnabled,
      hasJevApiKey: Boolean(channelKeys[channel]),
      ...settings.providerSettings?.[request.modelProvider] }
    return { ok: true, data: settings }
  })
  listProviderModels.mockResolvedValue({ ok: true, data: ['saved-custom-model'] })
  deleteProviderApiKey.mockImplementation(async (provider: ModelProvider) => {
    const state = { ...settings.providerSettings![provider]!, hasApiKey: false, apiKeySource: 'missing' as const }
    settings = { ...settings, ...(settings.modelProvider === provider ? state : {}),
      providerSettings: { ...settings.providerSettings, [provider]: state } }
    return { ok: true, data: settings }
  })
  vi.stubGlobal('englishAsk', {
    getSettings: vi.fn().mockImplementation(async () => ({ ok: true, data: settings })),
    listNotes: vi.fn().mockResolvedValue({ ok: true, data: [] }), saveSettings, listProviderModels, deleteProviderApiKey
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(() => root.render(<App />))
  await clickText('设置')
})

afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('shows read-only prompt settings in development', async () => {
  await clickText('提示词')
  const preview = query<HTMLTextAreaElement>('[aria-label="系统提示词预览"]')
  expect(preview.readOnly).toBe(true)
  expect(preview.value).toBe(settings.systemPrompt)
  expect(host.querySelectorAll('.promptPreview').length).toBeGreaterThan(0)
})

it('hides prompt navigation and previews in production without changing saved prompts', async () => {
  vi.stubEnv('DEV', false)
  await act(() => root.render(<App />))
  expect([...host.querySelectorAll('.settingsSidebarNav button')].map(item => item.textContent?.trim()))
    .toEqual(['模型', 'Jev（可选）', 'Notes'])
  expect(host.querySelector('[aria-label="提示词"]')).toBeNull()
  expect(host.querySelector('[aria-label="系统提示词预览"]')).toBeNull()
  expect(host.querySelector('.promptPreview')).toBeNull()
  await clickText('保存设置')
  expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ systemPrompt: 'Answer clearly.' }))
})

it('falls back to model settings when a selected prompt section is unavailable', async () => {
  await clickText('提示词')
  vi.stubEnv('DEV', false)
  await act(() => root.render(<App />))
  expect(host.querySelector('[aria-label="系统提示词预览"]')).toBeNull()
  expect(host.querySelector('#providerApiKey')).not.toBeNull()
  expect(host.querySelector('.settingsSidebarItem-active')?.textContent?.trim()).toBe('模型')
})

it('saves and reloads Jev independently and preserves its saved key on blank saves', async () => {
  expect(host.querySelector('#jevApiKey')).toBeNull()
  expect([...host.querySelectorAll('.settingsSidebarNav button')].map(item => item.textContent?.trim())).toEqual(['模型', 'Jev（可选）', '提示词', 'Notes'])
  await clickText('Jev（可选）')
  expect(host.querySelector('#providerApiKey')).toBeNull()
  const toggle = () => query<HTMLInputElement>('[aria-label="启用 Jev 模型"]')
  const key = () => query<HTMLInputElement>('#jevApiKey')
  expect(toggle().checked).toBe(true)
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(key(), 'jev-test-key')
    key().dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(() => toggle().click())
  await clickText('保存设置')
  expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({
    modelProvider: 'openai', modelName: 'gpt-4.1-mini', jevRoutingEnabled: false, jevApiKey: 'jev-test-key'
  }))
  expect(key().value).toBe('saved-gemini-api-key')
  expect(key().value).toBe('saved-gemini-api-key')
  await act(() => root.unmount())
  root = createRoot(host)
  await act(() => root.render(<App />))
  await clickText('设置')
  await clickText('Jev（可选）')
  expect(toggle().checked).toBe(false)
  expect(key().value).toBe('saved-gemini-api-key')
  await act(() => toggle().click())
  expect(host.querySelector('[aria-label="保存时删除 Jev 专用密钥"]')).toBeNull()
  await clickText('保存设置')
  expect(saveSettings.mock.lastCall?.[0]).not.toHaveProperty('removeJevApiKey')
  expect(key().value).toBe('saved-gemini-api-key')
  expect(settings.modelProvider).toBe('openai')
})

it('retains unsaved Jev edits on save failure', async () => {
  await clickText('Jev（可选）')
  saveSettings.mockResolvedValue({ ok: false, error: '保存失败' })
  await act(() => query<HTMLInputElement>('[aria-label="启用 Jev 模型"]').click())
  await clickText('保存设置')
  expect(query<HTMLInputElement>('[aria-label="启用 Jev 模型"]').checked).toBe(false)
  expect(host.textContent).toContain('保存失败')
})

it('switches the composer model through a provider submenu without sending credentials or unsaved settings', async () => {
  await selectProvider('DeepSeek')
  await clickText('返回')
  const trigger = () => query<HTMLButtonElement>('[aria-label="选择聊天模型"]')
  expect(trigger().textContent).toContain('gpt-4.1-mini')
  await act(() => trigger().click())
  const providerButtons = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  expect(providerButtons.find(button => button.textContent?.includes('Google Gemini'))).toBeUndefined()
  expect(providerButtons.map(button => button.textContent)).toEqual(['OpenAI', 'DeepSeek', 'OpenRouter', 'Anthropic / Claude'])
  const deepseek = providerButtons.find(button => button.textContent === 'DeepSeek')!
  await act(() => deepseek.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  expect(listProviderModels).toHaveBeenCalledWith({ modelProvider: 'deepseek' })
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
    .find(button => button.textContent === 'saved-custom-model')!
  await act(() => option.click())
  expect(saveSettings).toHaveBeenLastCalledWith({ modelProvider: 'deepseek', modelName: 'saved-custom-model',
    systemPrompt: 'Answer clearly.', defaultAnswerLanguage: 'zh' })
  expect(trigger().textContent).toContain('saved-custom-model')
  expect(document.querySelector('[aria-label="服务商模型"]')).toBeNull()
  await act(() => trigger().click())
  const activeProvider = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find(button => button.textContent === 'DeepSeek')!
  await act(() => activeProvider.click())
  expect(document.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent).toBe('saved-custom-model')
})

it('keeps menu dimensions stable while hovering providers and loading a longer model list', async () => {
  await act(() => root.unmount())
  root = createRoot(host)
  listProviderModels.mockResolvedValue({ ok: true, data: Array.from({ length: 50 }, (_, index) => `model-${index}`) })
  await act(() => root.render(<ComposerModelMenu settings={settings} disabled={false} label={settings.modelName}
    loadModels={listProviderModels} onSelect={vi.fn()} />))
  const trigger = query<HTMLButtonElement>('[aria-label="选择聊天模型"]')
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ top: 600, left: 100, bottom: 630, width: 160 } as DOMRect)
  await act(() => trigger.click())
  const menu = document.querySelector<HTMLElement>('.composerModelMenu')!
  const initialStyle = menu.getAttribute('style')
  const provider = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find(button => button.textContent === label)!
  await act(() => provider('DeepSeek').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  expect(menu.getAttribute('style')).toBe(initialStyle)
  expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(51)
  await act(() => provider('OpenRouter').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  expect(menu.getAttribute('style')).toBe(initialStyle)
  expect(listProviderModels.mock.calls.map(([provider]) => provider)).toEqual(['openai', 'deepseek', 'openrouter'])
})

it('retains the active model after a failed composer switch and supports keyboard dismissal', async () => {
  await clickText('返回')
  saveSettings.mockResolvedValue({ ok: false, error: '切换失败' })
  const trigger = query<HTMLButtonElement>('[aria-label="选择聊天模型"]')
  await act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  const provider = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent === 'OpenRouter')!
  await act(() => provider.click())
  await act(() => document.querySelector<HTMLButtonElement>('[role="menuitemradio"]')!.click())
  expect(document.body.textContent).toContain('切换失败')
  expect(trigger.textContent).toContain('gpt-4.1-mini')
  await act(() => provider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('.composerModelMenu')).toBeNull()
})

it('keeps saved keys masked and restores each model after updating another provider and remounting', async () => {
  const mask = input().value
  expect(mask.length).toBeGreaterThan(0)
  await act(() => input().focus())
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), 'test-new-openai-key')
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
  await clickText('保存设置')
  expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ modelProvider: 'openai', apiKey: 'test-new-openai-key' }))
  await selectProvider('DeepSeek')
  expect(input().value).toBe(mask)
  expect(model().textContent).toBe('saved-custom-model')
  expect(model().disabled).toBe(false)
  await act(() => query<HTMLButtonElement>('[aria-label="刷新模型列表"]').click())
  expect(listProviderModels).toHaveBeenLastCalledWith({ modelProvider: 'deepseek' })
  await clickText('保存设置')
  expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ modelProvider: 'deepseek', apiKey: '', modelName: 'saved-custom-model' }))
  await selectProvider('OpenAI')
  expect(input().value).toBe(mask)
  expect(model().textContent).toBe('gpt-4.1-mini')
  await act(() => root.unmount())
  root = createRoot(host)
  await act(() => root.render(<App />))
  await clickText('设置')
  await selectProvider('OpenAI')
  expect(input().value).toBe(mask)
  expect(model().textContent).toBe('gpt-4.1-mini')
})

it('enables environment-backed providers without a saved-key mask and keeps missing providers disabled', async () => {
  await selectProvider('OpenRouter')
  expect(input().value).toBe('')
  expect(model().disabled).toBe(false)
  await selectProvider('Google Gemini')
  expect(input().value).toBe('')
  expect(model().disabled).toBe(true)
  expect(query<HTMLButtonElement>('[aria-label="刷新模型列表"]').disabled).toBe(true)
})

async function openDeletion() {
  await act(() => query<HTMLButtonElement>('.deleteApiKeyButton').click())
}

it('requires confirmation, supports cancel and deletes only the selected inactive provider', async () => {
  await selectProvider('DeepSeek')
  const mask = input().value
  await openDeletion()
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('删除 DeepSeek 已保存的密钥？')
  expect(deleteProviderApiKey).not.toHaveBeenCalled()
  await clickText('取消')
  expect(input().value).toBe(mask)
  expect(deleteProviderApiKey).not.toHaveBeenCalled()
  await openDeletion()
  await clickText('删除密钥')
  expect(deleteProviderApiKey).toHaveBeenCalledExactlyOnceWith('deepseek')
  expect(saveSettings).not.toHaveBeenCalled()
  expect(input().value).toBe('')
  expect(host.querySelector('.deleteApiKeyButton')).toBeNull()
  expect(settings.modelProvider).toBe('openai')
  expect(settings.providerSettings?.deepseek?.modelName).toBe('saved-custom-model')
  await selectProvider('OpenAI')
  expect(input().value).toBe(mask)
  expect(model().textContent).toBe('gpt-4.1-mini')
  await selectProvider('OpenRouter')
  expect(host.querySelector('.deleteApiKeyButton')).toBeNull()
  await selectProvider('Google Gemini')
  expect(host.querySelector('.deleteApiKeyButton')).toBeNull()
})

it('shows the environment fallback after deleting a saved key', async () => {
  deleteProviderApiKey.mockImplementation(async () => ({ ok: true, data: {
    ...settings, apiKeySource: 'environment', providerSettings: { ...settings.providerSettings,
      openai: { ...settings.providerSettings!.openai!, apiKeySource: 'environment' } }
  } }))
  await openDeletion()
  await clickText('删除密钥')
  expect(input().value).toBe('')
  expect(model().disabled).toBe(false)
  expect(host.querySelector('.apiKeySourceLabel')?.textContent).toBe('正在使用环境变量密钥')
  expect(host.querySelector('.deleteApiKeyButton')).toBeNull()
})

it('locks editing while deletion is pending and preserves the saved key on failure', async () => {
  let finish!: (result: unknown) => void
  deleteProviderApiKey.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const mask = input().value
  await openDeletion()
  await clickText('删除密钥')
  expect(input().disabled).toBe(true)
  expect(query<HTMLButtonElement>('.deleteApiKeyButton').disabled).toBe(true)
  expect(query<HTMLButtonElement>('[aria-label="模型服务商"]').disabled).toBe(true)
  await act(() => finish({ ok: false, error: '无法删除已保存的密钥，请重试。' }))
  expect(host.textContent).toContain('无法删除已保存的密钥')
  expect(input().value).toBe(mask)
  expect(input().disabled).toBe(false)
})

it.each([
  ['OpenAI', 'openai', 'gpt-4.1-mini'], ['OpenRouter', 'openrouter', 'openai/gpt-4.1'],
  ['Anthropic / Claude', 'anthropic', 'claude-sonnet-5']
])(
  'refreshes %s and preserves the existing selection/list when refresh fails', async (label, provider, savedModel) => {
    if (provider !== 'openai') await selectProvider(label)
    const refresh = () => query<HTMLButtonElement>('[aria-label="刷新模型列表"]')
    expect(refresh().disabled).toBe(false)
    listProviderModels.mockResolvedValueOnce({ ok: true, data: [savedModel, 'new-text-model'] })
    await act(() => refresh().click())
    expect(listProviderModels).toHaveBeenLastCalledWith({ modelProvider: provider })
    expect(model().textContent).toBe(savedModel)
    listProviderModels.mockResolvedValueOnce({ ok: false, error: '模型列表请求超时，请重试。' })
    await act(() => refresh().click())
    expect(host.textContent).toContain('模型列表请求超时')
    expect(refresh().disabled).toBe(false)
    expect(model().textContent).toBe(savedModel)
    await act(() => model().click())
    expect([...document.querySelectorAll('[role="option"]')].map(option => option.textContent)).toContain('new-text-model')
  }
)

it.each([
  ['Anthropic / Claude', 'anthropic', 'claude-sonnet-5']
])('saves and deletes the selected %s provider without losing OpenAI settings', async (label, provider, modelName) => {
  await selectProvider(label)
  expect(input().value.length).toBeGreaterThan(0)
  expect(model().textContent).toBe(modelName)
  await clickText('保存设置')
  expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ modelProvider: provider, modelName }))
  await openDeletion()
  await clickText('删除密钥')
  expect(deleteProviderApiKey).toHaveBeenLastCalledWith(provider)
  expect(input().value).toBe('')
  await selectProvider('OpenAI')
  expect(input().value.length).toBeGreaterThan(0)
  expect(model().textContent).toBe('gpt-4.1-mini')
})


it('saves each settings page without submitting drafts from the other page', async () => {
  await selectProvider('DeepSeek')
  await clickText('Jev（可选）')
  await act(() => query<HTMLInputElement>('[aria-label="启用 Jev 模型"]').click())
  await clickText('保存设置')
  expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({
    modelProvider: 'openai', modelName: 'gpt-4.1-mini', jevRoutingEnabled: false
  }))
  expect(saveSettings.mock.lastCall?.[0]).not.toHaveProperty('apiKey')
  await act(() => query<HTMLInputElement>('[aria-label="启用 Jev 模型"]').click())
  await clickText('模型')
  expect(model().textContent).toBe('saved-custom-model')
  await clickText('保存设置')
  expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ modelProvider: 'deepseek' }))
  expect(saveSettings.mock.lastCall?.[0]).not.toHaveProperty('jevRoutingEnabled')
  expect(saveSettings.mock.lastCall?.[0]).not.toHaveProperty('jevApiKey')
  await clickText('Jev（可选）')
  expect(query<HTMLInputElement>('[aria-label="启用 Jev 模型"]').checked).toBe(true)
})


it('switches Jev channels with isolated drafts, matching model and Cloudflare credentials', async () => {
  await clickText('Jev（可选）')
  async function selectChannel(label: string) {
    await act(() => query<HTMLButtonElement>('[aria-label="Jev 服务商"]').click())
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent?.trim() === label)!
    await act(() => option.click())
  }
  async function typeKey(value: string) {
    await act(() => {
      const field = query<HTMLInputElement>('#jevApiKey')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  await typeKey('openrouter-draft')
  await selectChannel('Vercel AI Gateway')
  expect(query<HTMLInputElement>('#jevApiKey').value).toBe('')
  expect(query<HTMLInputElement>('[aria-label="Jev 模型"]').value).toBe('typesafe-ai/jev')
  await typeKey('vercel-key')
  await clickText('保存设置')
  expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ jevChannel: 'vercel', jevApiKey: 'vercel-key' }))
  expect(query<HTMLInputElement>('#jevApiKey').value).toBe('saved-gemini-api-key')
  await selectChannel('OpenRouter')
  expect(query<HTMLInputElement>('#jevApiKey').value).toBe('openrouter-draft')
  expect(query<HTMLInputElement>('#jevApiKey').placeholder).toBe('')
  await selectChannel('TypeSafe')
  expect(query<HTMLInputElement>('[aria-label="Jev 模型"]').value).toBe('jev-latest')
  await selectChannel('Cloudflare')
  expect(query<HTMLInputElement>('[aria-label="Jev 模型"]').value).toBe('typesafe/jev')
  await act(() => {
    const account = query<HTMLInputElement>('[aria-label="Cloudflare Account ID"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(account, '0123456789abcdef0123456789abcdef')
    account.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await typeKey('cloudflare-key')
  await clickText('保存设置')
  expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ jevChannel: 'cloudflare', jevApiKey: 'cloudflare-key', jevCloudflareAccountId: '0123456789abcdef0123456789abcdef' }))
  await act(() => root.unmount())
  root = createRoot(host)
  await act(() => root.render(<App />))
  await clickText('设置')
  await clickText('Jev（可选）')
  expect(query<HTMLButtonElement>('[aria-label="Jev 服务商"]').textContent).toBe('Cloudflare')
  expect(query<HTMLInputElement>('[aria-label="Cloudflare Account ID"]').value).toBe('0123456789abcdef0123456789abcdef')
  expect(query<HTMLInputElement>('#jevApiKey').value).toBe('saved-gemini-api-key')
})


it('disables Jev configuration while keeping enable and save available, and restores drafts when re-enabled', async () => {
  await clickText('Jev（可选）')
  const toggle = () => query<HTMLInputElement>('[aria-label="启用 Jev 模型"]')
  const fields = () => query<HTMLFieldSetElement>('[aria-label="Jev 配置"]')
  const key = () => query<HTMLInputElement>('#jevApiKey')
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(key(), 'preserved-draft')
    key().dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(() => toggle().click())
  expect(fields().disabled).toBe(true)
  expect([...fields().querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')].every(control => control.disabled)).toBe(true)
  expect(toggle().disabled).toBe(false)
  expect(query<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false)
  await act(() => query<HTMLButtonElement>('[aria-label="Jev 服务商"]').click())
  expect(document.querySelector('[role="listbox"]')).toBeNull()
  await act(() => toggle().click())
  expect(fields().disabled).toBe(false)
  expect(key().disabled).toBe(false)
  expect(key().value).toBe('preserved-draft')
  await act(() => toggle().click())
  await clickText('保存设置')
  expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ jevRoutingEnabled: false }))
  expect(fields().disabled).toBe(true)
})


it('masks saved Jev credentials like model settings without submitting the mask', async () => {
  settings.jevChannelKeys = { openrouter: true }
  await act(() => root.unmount())
  root = createRoot(host)
  await act(() => root.render(<App />))
  await clickText('设置')
  const modelMask = input().value
  await clickText('Jev（可选）')
  const key = () => query<HTMLInputElement>('#jevApiKey')
  expect(key().value).toBe(modelMask)
  expect(key().hasAttribute('placeholder')).toBe(false)
  await act(() => key().focus())
  expect(key().value).toBe('')
  await act(() => key().blur())
  expect(key().value).toBe(modelMask)
  await clickText('保存设置')
  expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ jevApiKey: '' }))
  expect(key().value).toBe(modelMask)
})


it.each(['model', 'jev'])('keeps %s password dot count unchanged after saving and reloading', async page => {
  const typedKey = 'test-key-with-a-longer-length-than-the-old-mask'
  saveSettings.mockImplementation(async (request: SaveSettingsRequest) => {
    settings = { ...settings,
      jevChannelKeys: { openrouter: true },
      jevChannelKeyLengths: { openrouter: (request.jevApiKey || typedKey).length },
      providerSettings: { ...settings.providerSettings,
        openai: { ...settings.providerSettings!.openai!, savedApiKeyLength: (request.apiKey || typedKey).length } }
    }
    return { ok: true, data: settings }
  })
  if (page === 'jev') await clickText('Jev（可选）')
  const key = () => query<HTMLInputElement>(page === 'jev' ? '#jevApiKey' : '#providerApiKey')
  await act(() => {
    key().focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(key(), typedKey)
    key().dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(key().value.length).toBe(typedKey.length)
  await clickText('保存设置')
  expect(key().value.length).toBe(typedKey.length)
  expect(key().value).not.toBe(typedKey)
  await act(() => root.unmount())
  root = createRoot(host)
  await act(() => root.render(<App />))
  await clickText('设置')
  if (page === 'jev') await clickText('Jev（可选）')
  expect(key().value.length).toBe(typedKey.length)
  await clickText('保存设置')
  expect(saveSettings.mock.lastCall?.[0][page === 'jev' ? 'jevApiKey' : 'apiKey']).toBe('')
})
