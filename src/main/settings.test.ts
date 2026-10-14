import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import { DEFAULT_ANSWER_LANGUAGE, DEFAULT_MODEL_PROVIDER, MODEL_PROVIDER_OPTIONS } from '../shared/ai'
import {
  getDefaultNoteStorageDirectory,
  deleteProviderApiKey,
  getSettingsState,
  getConfiguredOllamaBaseUrl,
  resetConfiguredNoteStorageDirectory,
  saveSettings,
  setConfiguredNoteStorageDirectory
} from './settings'
import {
  getDefaultSystemPrompt,
  LEGACY_ENGLISH_ASK_SYSTEM_PROMPTS
} from './prompt'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn()
  }
}))

describe('settings model provider', () => {
  it('defaults timestamps off, persists the switch, and preserves it across unrelated saves', async () => {
    const request = { modelProvider: 'ollama', modelName: 'qwen3:8b', defaultAnswerLanguage: 'zh', systemPrompt: 'Answer clearly.' }
    expect((await getSettingsState()).noteTitleTimestampEnabled).toBe(false)
    await saveSettings({ ...request, noteTitleTimestampEnabled: true })
    expect((await getSettingsState()).noteTitleTimestampEnabled).toBe(true)
    expect((await saveSettings(request)).noteTitleTimestampEnabled).toBe(true)
    expect((await saveSettings({ ...request, noteTitleTimestampEnabled: false })).noteTitleTimestampEnabled).toBe(false)
    await expect(saveSettings({ ...request, noteTitleTimestampEnabled: 'true' })).rejects.toThrow('must be boolean')
  })
  it('persists the normalized endpoint across reloads and unrelated saves', async () => {
    const request = { modelProvider: 'ollama', modelName: 'qwen3:8b', defaultAnswerLanguage: 'zh', systemPrompt: 'Answer clearly.' }
    expect(await getConfiguredOllamaBaseUrl()).toBe('http://127.0.0.1:11434')
    await saveSettings({ ...request, ollamaBaseUrl: ' http://192.168.1.20:11435/ ' })
    expect(await getConfiguredOllamaBaseUrl()).toBe('http://192.168.1.20:11435')
    await saveSettings({ ...request, modelProvider: 'openai', modelName: 'gpt-4.1' })
    expect((await getSettingsState()).ollamaBaseUrl).toBe('http://192.168.1.20:11435')
    const path = join(app.getPath('userData'), 'settings.json')
    const before = await readFile(path, 'utf8')
    await expect(saveSettings({ ...request, ollamaBaseUrl: 'https://user:secret@host' })).rejects.toThrow('Ollama 服务地址')
    expect(await readFile(path, 'utf8')).toBe(before)
  })

  beforeEach(async () => {
    const settingsDirectory = await mkdtemp(join(tmpdir(), 'english-ask-settings-'))
    vi.mocked(app.getPath).mockReturnValue(settingsDirectory)
    for (const name of ['GOOGLE_GENERATIVE_AI_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY']) {
      vi.stubEnv(name, '')
    }
  })

  afterEach(() => vi.unstubAllEnvs())

  it('persists Ollama without a key and preserves unrelated cloud credentials', async () => {
    const request = { defaultAnswerLanguage: 'zh', systemPrompt: 'Answer clearly.' }
    await saveSettings({ ...request, modelProvider: 'openai', modelName: 'gpt-4.1', apiKey: 'saved-cloud-key' })
    vi.stubEnv('OPENROUTER_API_KEY', 'environment-cloud-key')
    const state = await saveSettings({ ...request, modelProvider: 'ollama', modelName: 'qwen3:8b', apiKey: 'must-not-save' })
    expect(state).toMatchObject({ modelProvider: 'ollama', modelName: 'qwen3:8b', hasApiKey: false,
      apiKeySource: 'missing', providerSettings: { ollama: { modelName: 'qwen3:8b', hasApiKey: false }, openai: { hasApiKey: true } } })
    const stored = JSON.parse(await readFile(join(app.getPath('userData'), 'settings.json'), 'utf8'))
    expect(stored.apiKeys).toEqual({ openai: 'saved-cloud-key' })
    expect((await getSettingsState()).modelName).toBe('qwen3:8b')
  })

  it('persists Jev independently, hides its key and preserves it across unrelated or blank saves', async () => {
    const request = { modelProvider: 'openai', modelName: 'gpt-4.1-mini', defaultAnswerLanguage: 'zh', systemPrompt: 'Answer clearly.' }
    const path = join(app.getPath('userData'), 'settings.json')
    const state = await saveSettings({ ...request, apiKey: 'answer-key', jevRoutingEnabled: false, jevApiKey: ' dedicated-key ' })
    expect(state).toMatchObject({ jevRoutingEnabled: false, hasJevApiKey: true,
      jevChannelKeyLengths: { openrouter: 'dedicated-key'.length },
      providerSettings: { openai: { savedApiKeyLength: 'answer-key'.length } } })
    expect(JSON.stringify(state)).not.toContain('dedicated-key')
    await saveSettings({ ...request, jevApiKey: '' })
    await saveSettings(request)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ jevRoutingEnabled: false, jevApiKey: 'dedicated-key', apiKeys: { openai: 'answer-key' } })
    const removed = await saveSettings({ ...request, jevRoutingEnabled: true, removeJevApiKey: true })
    expect(removed).toMatchObject({ jevRoutingEnabled: true, hasJevApiKey: false, jevChannelKeyLengths: { openrouter: 0 } })
    expect(JSON.parse(await readFile(path, 'utf8')).apiKeys.openai).toBe('answer-key')
  })

  it.each([{ jevRoutingEnabled: 'false' }, { jevApiKey: 42 }, { removeJevApiKey: 'true' }])('rejects malformed Jev settings %j', async fields => {
    await expect(saveSettings(fields)).rejects.toThrow('Jev')
  })

  it('migrates legacy OpenRouter keys and isolates all channel keys through switching and deletion', async () => {
    const path = join(app.getPath('userData'), 'settings.json')
    const request = { modelProvider: 'openai', modelName: 'gpt-4.1-mini', defaultAnswerLanguage: 'zh', systemPrompt: 'Answer clearly.' }
    await writeFile(path, JSON.stringify({ jevApiKey: 'legacy-openrouter-key' }))
    expect(await getSettingsState()).toMatchObject({ jevChannel: 'openrouter', hasJevApiKey: true })
    for (const channel of ['vercel', 'typesafe', 'cloudflare']) {
      await saveSettings({ ...request, jevChannel: channel, jevApiKey: `${channel}-key`,
        ...(channel === 'cloudflare' ? { jevCloudflareAccountId: '0123456789abcdef0123456789abcdef' } : {}) })
    }
    await saveSettings(request)
    const stored = JSON.parse(await readFile(path, 'utf8'))
    expect(stored.jevApiKeys).toEqual({ openrouter: 'legacy-openrouter-key', vercel: 'vercel-key', typesafe: 'typesafe-key', cloudflare: 'cloudflare-key' })
    expect(stored.jevChannel).toBe('cloudflare')
    expect(stored.jevCloudflareAccountId).toBe('0123456789abcdef0123456789abcdef')
    const state = await saveSettings({ ...request, jevChannel: 'vercel', jevApiKey: '' })
    expect(state.jevChannelKeys).toEqual({ openrouter: true, vercel: true, typesafe: true, cloudflare: true })
    expect(JSON.stringify(state)).not.toContain('vercel-key')
    await saveSettings({ ...request, jevChannel: 'openrouter', removeJevApiKey: true })
    const removed = JSON.parse(await readFile(path, 'utf8'))
    expect(removed.jevApiKeys.openrouter).toBeUndefined()
    expect(removed.jevApiKey).toBeUndefined()
    expect(removed.jevApiKeys.vercel).toBe('vercel-key')
  })

  it.each([{ jevChannel: 'invented' }, { jevChannel: 'cloudflare', jevCloudflareAccountId: '../account' }])('rejects invalid channel configuration %j', async fields => {
    await expect(saveSettings(fields)).rejects.toThrow()
  })

  it.each(['bailian', 'anthropic'])('loads old %s settings after Bailian removal without losing other credentials', async activeProvider => {
    const settingsPath = join(app.getPath('userData'), 'settings.json')
    await writeFile(settingsPath, JSON.stringify({
      modelProvider: activeProvider,
      apiKeys: { bailian: 'retired-key', anthropic: 'claude-key', openai: 'openai-key' },
      models: { bailian: 'qwen-plus', anthropic: 'claude-sonnet-5', openai: 'gpt-4.1-mini' }
    }))
    const state = await getSettingsState()
    expect(state.modelProvider).toBe(activeProvider === 'bailian' ? DEFAULT_MODEL_PROVIDER : 'anthropic')
    expect(state.providerSettings).not.toHaveProperty('bailian')
    expect(state.providerSettings?.anthropic).toMatchObject({ hasApiKey: true, modelName: 'claude-sonnet-5' })
    expect(state.providerSettings?.openai).toMatchObject({ hasApiKey: true, modelName: 'gpt-4.1-mini' })
    await saveSettings({ modelProvider: 'anthropic', modelName: 'claude-sonnet-5', defaultAnswerLanguage: 'zh', systemPrompt: 'Answer clearly.' })
    const stored = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(stored.apiKeys).toEqual({ anthropic: 'claude-key', openai: 'openai-key' })
    expect(stored.models).toEqual({ anthropic: 'claude-sonnet-5', openai: 'gpt-4.1-mini' })
    await expect(saveSettings({ modelProvider: 'bailian' })).rejects.toThrow('not supported')
  })

  it.each([
    ['anthropic', 'ANTHROPIC_API_KEY', 'claude-sonnet-5']
  ] as const)('saves %s independently and falls back to its own environment key', async (provider, env, model) => {
    vi.stubEnv('OPENROUTER_API_KEY', 'unrelated-key')
    expect((await getSettingsState()).providerSettings?.[provider]?.hasApiKey).toBe(false)
    vi.stubEnv(env, 'environment-key')
    const result = await saveSettings({ modelProvider: provider, modelName: model, apiKey: 'saved-key', defaultAnswerLanguage: 'zh', systemPrompt: 'Answer clearly.' })
    expect(result).toMatchObject({ modelProvider: provider, modelName: model, apiKeySource: 'app' })
    expect((await deleteProviderApiKey(provider)).providerSettings?.[provider]?.apiKeySource).toBe('environment')
  })

  it.each(MODEL_PROVIDER_OPTIONS)('deletes only the saved $id key and preserves all other settings', async ({ id }) => {
    const path = join(app.getPath('userData'), 'settings.json')
    const initial = {
      modelProvider: 'openai',
      apiKeys: { 'google-gemini': 'test-gemini', openai: 'test-openai', deepseek: 'test-deepseek', openrouter: 'test-openrouter', anthropic: 'test-anthropic' },
      geminiApiKey: 'test-gemini', geminiModel: 'gemini-2.5-pro',
      models: { 'google-gemini': 'gemini-2.5-pro', openai: 'gpt-4.1-mini', deepseek: 'deepseek-v4-pro', openrouter: 'openai/gpt-4.1', anthropic: 'claude-sonnet-5' },
      systemPrompt: 'Answer clearly.', defaultAnswerLanguage: 'zh', noteStorageDirectory: '/test/notes'
    }
    await writeFile(path, JSON.stringify(initial))
    const result = await deleteProviderApiKey(id)
    const expectedKeys: Partial<typeof initial.apiKeys> = { ...initial.apiKeys }
    delete expectedKeys[id]
    const stored = JSON.parse(await readFile(path, 'utf8'))
    expect(stored).toEqual({ ...initial, apiKeys: expectedKeys,
      ...(id === 'google-gemini' ? { geminiApiKey: undefined } : {}) })
    expect(result.providerSettings?.[id]).toMatchObject({ hasApiKey: false, apiKeySource: 'missing' })
    expect((await getSettingsState()).providerSettings?.[id]?.hasApiKey).toBe(false)
    if (id === 'google-gemini') expect(stored).not.toHaveProperty('geminiApiKey')
  })

  it('falls back to an environment key after deletion and supports repeated deletion', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-environment-key')
    await saveSettings({ modelProvider: 'openai', apiKey: 'test-app-key', modelName: 'gpt-4.1', defaultAnswerLanguage: 'zh', systemPrompt: 'Answer clearly.' })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await deleteProviderApiKey('openai')
      expect(result.apiKeySource).toBe('environment')
      expect(result.hasApiKey).toBe(true)
      expect(JSON.stringify(result)).not.toContain('test-environment-key')
    }
  })

  it.each([undefined, null, 'invalid', {}])('rejects invalid deletion targets without changing settings: %j', async provider => {
    const path = join(app.getPath('userData'), 'settings.json')
    const original = JSON.stringify({ geminiApiKey: 'test-preserved-key' })
    await writeFile(path, original)
    await expect(deleteProviderApiKey(provider)).rejects.toThrow('not supported')
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it('preserves both providers when updating one and switching back with a blank key', async () => {
    const defaults = { defaultAnswerLanguage: 'zh', systemPrompt: 'Answer clearly.' }
    await saveSettings({ ...defaults, modelProvider: 'deepseek', apiKey: 'test-deepseek-original', modelName: 'deepseek-v4-pro' })
    await saveSettings({ ...defaults, modelProvider: 'openai', apiKey: 'test-openai-original', modelName: 'gpt-4.1-mini' })
    await saveSettings({ ...defaults, modelProvider: 'openai', apiKey: 'test-openai-updated', modelName: 'gpt-4.1-mini' })
    await saveSettings({ ...defaults, modelProvider: 'deepseek', apiKey: '  ', modelName: 'deepseek-v4-pro' })

    const stored = JSON.parse(await readFile(join(app.getPath('userData'), 'settings.json'), 'utf8'))
    expect(stored.apiKeys).toEqual({ deepseek: 'test-deepseek-original', openai: 'test-openai-updated' })
    expect(stored.models).toEqual({ deepseek: 'deepseek-v4-pro', openai: 'gpt-4.1-mini' })
    const state = await getSettingsState()
    expect(state.providerSettings).toMatchObject({
      deepseek: { hasApiKey: true, apiKeySource: 'app', modelName: 'deepseek-v4-pro' },
      openai: { hasApiKey: true, apiKeySource: 'app', modelName: 'gpt-4.1-mini' },
      openrouter: { hasApiKey: false, apiKeySource: 'missing' }
    })
    for (const key of Object.values(stored.apiKeys) as string[]) expect(JSON.stringify(state)).not.toContain(key)
  })

  it('reports environment credentials for inactive providers and gives stored credentials precedence', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-environment-key')
    expect((await getSettingsState()).providerSettings?.openai).toMatchObject({ hasApiKey: true, apiKeySource: 'environment' })
    await saveSettings({ modelProvider: 'openai', apiKey: 'test-app-key', modelName: 'gpt-4.1', defaultAnswerLanguage: 'zh', systemPrompt: 'Answer clearly.' })
    expect((await getSettingsState()).providerSettings?.openai).toMatchObject({ hasApiKey: true, apiKeySource: 'app' })
  })

  it('includes legacy Gemini credentials and models in provider metadata', async () => {
    await writeFile(join(app.getPath('userData'), 'settings.json'), JSON.stringify({ geminiApiKey: 'test-legacy-key', geminiModel: 'gemini-2.5-pro', modelProvider: 'openai' }))
    expect((await getSettingsState()).providerSettings?.['google-gemini']).toEqual({ hasApiKey: true, apiKeySource: 'app', modelName: 'gemini-2.5-pro', savedApiKeyLength: 'test-legacy-key'.length })
  })

  it('uses Google Gemini when settings do not have a provider yet', async () => {
    await expect(getSettingsState()).resolves.toMatchObject({
      modelProvider: DEFAULT_MODEL_PROVIDER,
      defaultAnswerLanguage: DEFAULT_ANSWER_LANGUAGE,
      noteStorageDirectory: getDefaultNoteStorageDirectory(),
      noteStorageSource: 'default'
    })
  })

  it('uses the new adaptive prompt when stored settings contain a known concise default', async () => {
    const settingsPath = join(app.getPath('userData'), 'settings.json')

    await writeFile(
      settingsPath,
      JSON.stringify({
        systemPrompt: LEGACY_ENGLISH_ASK_SYSTEM_PROMPTS[1]
      })
    )

    await expect(getSettingsState()).resolves.toMatchObject({
      systemPrompt: getDefaultSystemPrompt()
    })
  })

  it('stores an absolute custom Notes directory and preserves it with other settings', async () => {
    const customNotesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-custom-notes-'))

    await expect(setConfiguredNoteStorageDirectory(customNotesDirectory)).resolves.toMatchObject({
      noteStorageDirectory: customNotesDirectory,
      noteStorageSource: 'custom'
    })

    await saveSettings({
      modelProvider: DEFAULT_MODEL_PROVIDER,
      apiKey: 'test-key',
      modelName: 'gemini-2.5-flash',
      defaultAnswerLanguage: 'en',
      systemPrompt: 'Answer clearly.'
    })

    await expect(getSettingsState()).resolves.toMatchObject({
      noteStorageDirectory: customNotesDirectory,
      noteStorageSource: 'custom'
    })
  })

  it('resets Notes storage to the app default directory', async () => {
    const customNotesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-custom-notes-'))

    await setConfiguredNoteStorageDirectory(customNotesDirectory)

    await expect(resetConfiguredNoteStorageDirectory()).resolves.toMatchObject({
      noteStorageDirectory: getDefaultNoteStorageDirectory(),
      noteStorageSource: 'default'
    })
  })

  it('rejects relative Notes storage paths', async () => {
    await expect(setConfiguredNoteStorageDirectory('relative/notes')).rejects.toThrow(
      'Notes storage directory must be an absolute path.'
    )
  })

  it('saves the selected model provider and default answer language', async () => {
    await saveSettings({
      modelProvider: DEFAULT_MODEL_PROVIDER,
      apiKey: 'test-key',
      modelName: 'gemini-2.5-flash',
      defaultAnswerLanguage: 'zh',
      systemPrompt: 'Answer clearly.'
    })

    const settingsPath = join(app.getPath('userData'), 'settings.json')
    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>

    expect(settings.modelProvider).toBe(DEFAULT_MODEL_PROVIDER)
    expect(settings.apiKeys).toEqual({ 'google-gemini': 'test-key' })
    expect(settings.models).toEqual({ 'google-gemini': 'gemini-2.5-flash' })
    expect(settings.defaultAnswerLanguage).toBe('zh')
  })

  it.each(['bilingual', 'en'])('migrates a stored %s language preference to Chinese', async language => {
    const settingsPath = join(app.getPath('userData'), 'settings.json')

    await writeFile(
      settingsPath,
      JSON.stringify({
        defaultAnswerLanguage: language
      })
    )

    await expect(getSettingsState()).resolves.toMatchObject({
      defaultAnswerLanguage: 'zh'
    })
  })

  it('preserves the saved API key and stores Chinese when an old client requests English', async () => {
    await saveSettings({
      modelProvider: DEFAULT_MODEL_PROVIDER,
      apiKey: 'test-key',
      modelName: 'gemini-2.5-flash',
      defaultAnswerLanguage: 'zh',
      systemPrompt: 'Answer clearly.'
    })

    await saveSettings({
      modelProvider: DEFAULT_MODEL_PROVIDER,
      modelName: 'gemini-2.5-flash',
      defaultAnswerLanguage: 'en',
      systemPrompt: 'Answer clearly.'
    })

    const settingsPath = join(app.getPath('userData'), 'settings.json')
    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>

    expect(settings.apiKeys).toEqual({ 'google-gemini': 'test-key' })
    expect(settings.defaultAnswerLanguage).toBe('zh')
  })

  it('saves provider-specific API keys and models', async () => {
    await saveSettings({
      modelProvider: 'openai',
      apiKey: 'openai-key',
      modelName: 'gpt-4.1',
      defaultAnswerLanguage: 'en',
      systemPrompt: 'Answer clearly.'
    })

    const settingsPath = join(app.getPath('userData'), 'settings.json')
    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>

    expect(settings.modelProvider).toBe('openai')
    expect(settings.apiKeys).toEqual({ openai: 'openai-key' })
    expect(settings.models).toEqual({ openai: 'gpt-4.1' })
  })
})
