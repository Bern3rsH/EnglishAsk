import { JEV_CHANNELS, isJevChannel, isCloudflareAccountId, type JevChannel } from '../shared/jev'
import { app } from 'electron'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'
import {
  DEFAULT_MODEL_OPTIONS_BY_PROVIDER,
  MODEL_PROVIDER_OPTIONS,
  type DefaultAnswerLanguage,
  type GeminiModel,
  type ModelProvider,
  type NoteStorageSource,
  type ProviderModel,
  type ProviderSettingsState,
  type SettingsState
} from '../shared/ai'
import { normalizeDefaultAnswerLanguage } from './answer-language'
import { DEFAULT_GEMINI_MODEL } from './ai-request'
import { isGeminiModel, normalizeGeminiModel } from './model'
import { isModelProvider, normalizeModelProvider } from './model-provider'
import {
  getDefaultSystemPrompt,
  normalizeStoredSystemPrompt,
  normalizeSystemPrompt
} from './prompt'

const SETTINGS_FILE_NAME = 'settings.json'
const SETTINGS_FILE_MODE = 0o600
const DEFAULT_NOTES_DIRECTORY_NAME = 'notes'

interface StoredSettings {
  jevChannel?: JevChannel
  jevApiKeys?: Partial<Record<JevChannel, string>>
  jevCloudflareAccountId?: string
  jevRoutingEnabled?: boolean
  jevApiKey?: string
  modelProvider?: ModelProvider
  apiKeys?: Partial<Record<ModelProvider, string>>
  models?: Partial<Record<ModelProvider, ProviderModel>>
  geminiApiKey?: string
  geminiModel?: GeminiModel
  defaultAnswerLanguage?: DefaultAnswerLanguage
  systemPrompt?: string
  noteStorageDirectory?: string
}

const assertRecord: (value: unknown) => asserts value is Record<string, unknown> = (value) => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Settings request must be an object.')
  }
}

const normalizeOptionalGeminiApiKey = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error('Gemini API key must be a string.')
  }

  const normalizedApiKey = value.trim()

  return normalizedApiKey.length > 0 ? normalizedApiKey : undefined
}

const normalizeProviderModel = (value: unknown): ProviderModel => {
  if (typeof value !== 'string') {
    throw new Error('Model must be a string.')
  }

  const model = value.trim().replace(/^models\//, '')

  if (model.length === 0) {
    throw new Error('Model cannot be empty.')
  }

  if (/\s/.test(model)) {
    throw new Error('Model cannot contain whitespace.')
  }

  if (model.length > 160) {
    throw new Error('Model must be 160 characters or fewer.')
  }

  return model
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const normalizeProviderApiKeys = (
  value: unknown,
  legacyGeminiApiKey: unknown
): Partial<Record<ModelProvider, string>> => {
  const apiKeys: Partial<Record<ModelProvider, string>> = {}

  if (isRecord(value)) {
    for (const [providerId, apiKey] of Object.entries(value)) {
      if (providerId === 'bailian') continue
      const modelProvider = normalizeModelProvider(providerId)
      const normalizedApiKey = normalizeOptionalGeminiApiKey(apiKey)

      if (normalizedApiKey) {
        apiKeys[modelProvider] = normalizedApiKey
      }
    }
  }

  const normalizedLegacyGeminiApiKey = normalizeOptionalGeminiApiKey(legacyGeminiApiKey)

  if (normalizedLegacyGeminiApiKey && !apiKeys['google-gemini']) {
    apiKeys['google-gemini'] = normalizedLegacyGeminiApiKey
  }

  return apiKeys
}

const normalizeJevApiKeys = (value: unknown, legacy: unknown): Partial<Record<JevChannel, string>> => {
  const keys: Partial<Record<JevChannel, string>> = {}
  if (isRecord(value)) {
    for (const channel of Object.keys(JEV_CHANNELS) as JevChannel[]) {
      const key = normalizeOptionalGeminiApiKey(value[channel])
      if (key) keys[channel] = key
    }
  }
  const legacyKey = normalizeOptionalGeminiApiKey(legacy)
  if (!keys.openrouter && legacyKey) keys.openrouter = legacyKey
  return keys
}

const normalizeProviderModels = (
  value: unknown,
  legacyGeminiModel: unknown
): Partial<Record<ModelProvider, ProviderModel>> => {
  const models: Partial<Record<ModelProvider, ProviderModel>> = {}

  if (isRecord(value)) {
    for (const [providerId, modelName] of Object.entries(value)) {
      if (providerId === 'bailian') continue
      const modelProvider = normalizeModelProvider(providerId)
      models[modelProvider] =
        modelProvider === 'google-gemini'
          ? normalizeGeminiModel(modelName)
          : normalizeProviderModel(modelName)
    }
  }

  if (isGeminiModel(legacyGeminiModel) && !models['google-gemini']) {
    models['google-gemini'] = normalizeGeminiModel(legacyGeminiModel)
  }

  return models
}

const getDefaultProviderModel = (modelProvider: ModelProvider): ProviderModel => {
  return DEFAULT_MODEL_OPTIONS_BY_PROVIDER[modelProvider][0]
}

export const getEnvironmentProviderApiKey = (modelProvider: ModelProvider): string | undefined => {
  if (modelProvider === 'google-gemini') {
    return process.env.GOOGLE_GENERATIVE_AI_API_KEY
  }

  if (modelProvider === 'openai') {
    return process.env.OPENAI_API_KEY
  }

  if (modelProvider === 'deepseek') {
    return process.env.DEEPSEEK_API_KEY
  }

  if (modelProvider === 'anthropic') {
    return process.env.ANTHROPIC_API_KEY
  }

  return process.env.OPENROUTER_API_KEY
}

const getEnvironmentGeminiModel = (): GeminiModel | undefined => {
  if (process.env.GEMINI_MODEL && isGeminiModel(process.env.GEMINI_MODEL)) {
    return normalizeGeminiModel(process.env.GEMINI_MODEL)
  }

  return undefined
}

const getSettingsPath = (): string => {
  return join(app.getPath('userData'), SETTINGS_FILE_NAME)
}

export const getDefaultNoteStorageDirectory = (): string => {
  return join(app.getPath('userData'), DEFAULT_NOTES_DIRECTORY_NAME)
}

const normalizeStoredNoteStorageDirectory = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  const directory = value.trim()

  return directory.length > 0 && isAbsolute(directory) ? normalize(directory) : undefined
}

const readStoredSettings = async (): Promise<StoredSettings> => {
  try {
    const rawSettings = await readFile(getSettingsPath(), 'utf8')
    const parsedSettings = JSON.parse(rawSettings) as StoredSettings

    return {
      jevChannel: isJevChannel(parsedSettings.jevChannel) ? parsedSettings.jevChannel : undefined,
      jevApiKeys: parsedSettings.jevApiKeys || parsedSettings.jevApiKey
        ? normalizeJevApiKeys(parsedSettings.jevApiKeys, parsedSettings.jevApiKey) : undefined,
      jevCloudflareAccountId: typeof parsedSettings.jevCloudflareAccountId === 'string'
        ? parsedSettings.jevCloudflareAccountId.trim() : undefined,
      jevRoutingEnabled: typeof parsedSettings.jevRoutingEnabled === 'boolean' ? parsedSettings.jevRoutingEnabled : undefined,
      jevApiKey: normalizeOptionalGeminiApiKey(parsedSettings.jevApiKey),
      modelProvider: normalizeModelProvider(
        (parsedSettings as { modelProvider?: string }).modelProvider === 'bailian'
          ? undefined : parsedSettings.modelProvider
      ),
      apiKeys: normalizeProviderApiKeys(parsedSettings.apiKeys, parsedSettings.geminiApiKey),
      models: normalizeProviderModels(parsedSettings.models, parsedSettings.geminiModel),
      geminiApiKey:
        typeof parsedSettings.geminiApiKey === 'string'
          ? parsedSettings.geminiApiKey.trim()
          : undefined,
      geminiModel:
        isGeminiModel(parsedSettings.geminiModel)
          ? normalizeGeminiModel(parsedSettings.geminiModel)
          : undefined,
      defaultAnswerLanguage: normalizeDefaultAnswerLanguage(parsedSettings.defaultAnswerLanguage),
      systemPrompt: normalizeStoredSystemPrompt(parsedSettings.systemPrompt),
      noteStorageDirectory: normalizeStoredNoteStorageDirectory(
        parsedSettings.noteStorageDirectory
      )
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {}
    }

    throw error
  }
}

const writeStoredSettings = async (settings: StoredSettings): Promise<void> => {
  const settingsPath = getSettingsPath()

  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: 'utf8',
    mode: SETTINGS_FILE_MODE
  })
  await chmod(settingsPath, SETTINGS_FILE_MODE)
}

export const getConfiguredNoteStorageDirectory = async (): Promise<string> => {
  const settings = await readStoredSettings()
  return settings.noteStorageDirectory ?? getDefaultNoteStorageDirectory()
}

export const getNoteStorageSource = async (): Promise<NoteStorageSource> => {
  const settings = await readStoredSettings()
  return settings.noteStorageDirectory ? 'custom' : 'default'
}

export const setConfiguredNoteStorageDirectory = async (
  directory: unknown
): Promise<SettingsState> => {
  if (typeof directory !== 'string' || directory.trim().length === 0) {
    throw new Error('Notes storage directory must be a non-empty path.')
  }

  const normalizedDirectory = normalize(directory.trim())

  if (!isAbsolute(normalizedDirectory)) {
    throw new Error('Notes storage directory must be an absolute path.')
  }

  await mkdir(normalizedDirectory, { recursive: true })

  const directoryStats = await stat(normalizedDirectory)

  if (!directoryStats.isDirectory()) {
    throw new Error('Notes storage path must be a directory.')
  }

  const existingSettings = await readStoredSettings()

  await writeStoredSettings({
    ...existingSettings,
    noteStorageDirectory: normalizedDirectory
  })

  return getSettingsState()
}

export const resetConfiguredNoteStorageDirectory = async (): Promise<SettingsState> => {
  const existingSettings = await readStoredSettings()
  const { noteStorageDirectory: _, ...nextSettings } = existingSettings

  await mkdir(getDefaultNoteStorageDirectory(), { recursive: true })
  await writeStoredSettings(nextSettings)

  return getSettingsState()
}

export const getConfiguredModelProvider = async (): Promise<ModelProvider> => {
  const settings = await readStoredSettings()
  return settings.modelProvider ?? normalizeModelProvider(undefined)
}

export const getStoredProviderApiKey = async (
  modelProvider: ModelProvider
): Promise<string | undefined> => {
  const settings = await readStoredSettings()
  const apiKey = settings.apiKeys?.[modelProvider]
  return apiKey && apiKey.length > 0 ? apiKey : undefined
}

export const getStoredGeminiApiKey = async (): Promise<string | undefined> => {
  return getStoredProviderApiKey('google-gemini')
}

export const getStoredJevConfiguration = async (): Promise<{ enabled: boolean; channel: JevChannel; apiKey?: string; accountId?: string }> => {
  const settings = await readStoredSettings()
  const channel = settings.jevChannel ?? 'openrouter'
  return { enabled: settings.jevRoutingEnabled ?? true, channel,
    apiKey: settings.jevApiKeys?.[channel] ?? (channel === 'openrouter' ? settings.jevApiKey : undefined),
    accountId: settings.jevCloudflareAccountId }
}

export const getConfiguredProviderModel = async (
  modelProvider: ModelProvider
): Promise<ProviderModel> => {
  const settings = await readStoredSettings()

  if (modelProvider === 'google-gemini') {
    return settings.models?.[modelProvider] ?? getEnvironmentGeminiModel() ?? DEFAULT_GEMINI_MODEL
  }

  return settings.models?.[modelProvider] ?? getDefaultProviderModel(modelProvider)
}

export const getConfiguredGeminiModel = async (): Promise<GeminiModel> => {
  const model = await getConfiguredProviderModel('google-gemini')
  return isGeminiModel(model)
    ? normalizeGeminiModel(model)
    : getEnvironmentGeminiModel() ?? DEFAULT_GEMINI_MODEL
}

export const getConfiguredSystemPrompt = async (): Promise<string> => {
  const settings = await readStoredSettings()
  return settings.systemPrompt ?? getDefaultSystemPrompt()
}

export const getConfiguredDefaultAnswerLanguage = async (): Promise<DefaultAnswerLanguage> => {
  const settings = await readStoredSettings()
  return settings.defaultAnswerLanguage ?? normalizeDefaultAnswerLanguage(undefined)
}

export const getSettingsState = async (): Promise<SettingsState> => {
  const storedSettings = await readStoredSettings()
  const modelProvider = storedSettings.modelProvider ?? normalizeModelProvider(undefined)
  // Expose availability and model choices, never the saved credentials themselves.
  const providerSettings = Object.fromEntries(MODEL_PROVIDER_OPTIONS.map(({ id }) => {
    const apiKeySource = storedSettings.apiKeys?.[id]
      ? 'app'
      : getEnvironmentProviderApiKey(id) ? 'environment' : 'missing'
    const state: ProviderSettingsState = {
      savedApiKeyLength: storedSettings.apiKeys?.[id]?.length ?? 0,
      hasApiKey: apiKeySource !== 'missing',
      apiKeySource,
      modelName: storedSettings.models?.[id] ??
        (id === 'google-gemini' ? getEnvironmentGeminiModel() : undefined) ??
        getDefaultProviderModel(id)
    }
    return [id, state]
  }))
  const storedApiKey = await getStoredProviderApiKey(modelProvider)
  const storedGeminiApiKey = await getStoredProviderApiKey('google-gemini')
  const hasGeminiApiKey = Boolean(
    storedGeminiApiKey ?? getEnvironmentProviderApiKey('google-gemini')
  )
  const modelName = await getConfiguredProviderModel(modelProvider)
  const geminiModel = await getConfiguredGeminiModel()
  const defaultAnswerLanguage = await getConfiguredDefaultAnswerLanguage()
  const systemPrompt = await getConfiguredSystemPrompt()
  const noteStorageDirectory = await getConfiguredNoteStorageDirectory()
  const noteStorageSource = await getNoteStorageSource()
  const baseSettings = {
    jevRoutingEnabled: storedSettings.jevRoutingEnabled ?? true,
    jevChannel: storedSettings.jevChannel ?? 'openrouter',
    jevChannelKeyLengths: Object.fromEntries(Object.keys(JEV_CHANNELS).map(channel =>
      [channel, storedSettings.jevApiKeys?.[channel as JevChannel]?.length ?? 0])),
    jevChannelKeys: Object.fromEntries(Object.keys(JEV_CHANNELS).map(channel =>
      [channel, Boolean(storedSettings.jevApiKeys?.[channel as JevChannel])])),
    jevCloudflareAccountId: storedSettings.jevCloudflareAccountId ?? '',
    hasJevApiKey: Boolean(storedSettings.jevApiKeys?.[storedSettings.jevChannel ?? 'openrouter']),
    providerSettings,
    modelProvider,
    modelName,
    geminiModel,
    defaultAnswerLanguage,
    systemPrompt,
    noteStorageDirectory,
    noteStorageSource
  }

  if (storedApiKey) {
    return {
      ...baseSettings,
      hasApiKey: true,
      hasGeminiApiKey,
      apiKeySource: 'app',
    }
  }

  if (getEnvironmentProviderApiKey(modelProvider)) {
    return {
      ...baseSettings,
      hasApiKey: true,
      hasGeminiApiKey,
      apiKeySource: 'environment',
    }
  }

  return {
    ...baseSettings,
    hasApiKey: false,
    hasGeminiApiKey,
    apiKeySource: 'missing',
  }
}

export const deleteProviderApiKey = async (provider: unknown): Promise<SettingsState> => {
  if (!isModelProvider(provider)) throw new Error('Model provider is not supported.')
  const existingSettings = await readStoredSettings()
  const apiKeys = { ...existingSettings.apiKeys }
  delete apiKeys[provider]
  const nextSettings: StoredSettings = { ...existingSettings, apiKeys }
  if (provider === 'google-gemini') delete nextSettings.geminiApiKey
  await writeStoredSettings(nextSettings)
  return getSettingsState()
}

export const saveSettings = async (request: unknown): Promise<SettingsState> => {
  assertRecord(request)

  for (const field of ['jevRoutingEnabled', 'removeJevApiKey']) {
    if (request[field] !== undefined && typeof request[field] !== 'boolean') {
      throw new Error('Jev settings flags must be boolean.')
    }
  }
  if (request.jevApiKey !== undefined && typeof request.jevApiKey !== 'string') {
    throw new Error('Jev API key must be a string.')
  }
  const jevApiKey = typeof request.jevApiKey === 'string' ? request.jevApiKey.trim() : undefined

  if (request.jevChannel !== undefined && !isJevChannel(request.jevChannel)) {
    throw new Error('Jev channel is not supported.')
  }
  if (request.jevCloudflareAccountId !== undefined && (typeof request.jevCloudflareAccountId !== 'string' ||
      (request.jevCloudflareAccountId.trim() && !isCloudflareAccountId(request.jevCloudflareAccountId.trim())))) {
    throw new Error('Cloudflare Account ID 必须为 32 位十六进制字符。')
  }
  const existingSettings = await readStoredSettings()
  const jevChannel = isJevChannel(request.jevChannel) ? request.jevChannel : existingSettings.jevChannel ?? 'openrouter'
  const jevApiKeys = { ...existingSettings.jevApiKeys }
  if (request.removeJevApiKey === true) delete jevApiKeys[jevChannel]
  else if (jevApiKey) jevApiKeys[jevChannel] = jevApiKey
  const modelProvider = normalizeModelProvider(request.modelProvider)
  const apiKey = normalizeOptionalGeminiApiKey(request.apiKey ?? request.geminiApiKey)
  const modelName =
    modelProvider === 'google-gemini'
      ? normalizeGeminiModel(request.modelName ?? request.geminiModel)
      : normalizeProviderModel(request.modelName)
  const defaultAnswerLanguage = normalizeDefaultAnswerLanguage(request.defaultAnswerLanguage)
  const systemPrompt = normalizeSystemPrompt(request.systemPrompt)
  const apiKeys = {
    ...existingSettings.apiKeys,
    ...(apiKey ? { [modelProvider]: apiKey } : {})
  }
  const models = {
    ...existingSettings.models,
    [modelProvider]: modelName
  }
  const nextSettings: StoredSettings = {
    jevRoutingEnabled: typeof request.jevRoutingEnabled === 'boolean'
      ? request.jevRoutingEnabled : existingSettings.jevRoutingEnabled,
    jevChannel,
    jevApiKeys,
    jevApiKey: jevApiKeys.openrouter,
    jevCloudflareAccountId: typeof request.jevCloudflareAccountId === 'string'
      ? request.jevCloudflareAccountId.trim() : existingSettings.jevCloudflareAccountId,
    modelProvider,
    apiKeys,
    models,
    geminiApiKey: apiKeys['google-gemini'],
    geminiModel: models['google-gemini'],
    defaultAnswerLanguage,
    systemPrompt,
    noteStorageDirectory: existingSettings.noteStorageDirectory
  }

  await writeStoredSettings(nextSettings)

  return getSettingsState()
}
