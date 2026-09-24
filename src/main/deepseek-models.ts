import { DEFAULT_MODEL_OPTIONS_BY_PROVIDER } from '../shared/ai'
import { getEnvironmentProviderApiKey, getStoredProviderApiKey } from './settings'
import { filterTextModelIds } from './text-model-filter'

const DEEPSEEK_MODELS_ENDPOINT = 'https://api.deepseek.com/models'
const AUTHORIZATION_HEADER = 'Authorization'

interface DeepSeekModelListItem {
  id?: string
}

interface DeepSeekModelListResponse {
  data?: DeepSeekModelListItem[]
}

interface DeepSeekErrorResponse {
  error?: {
    message?: string
  }
}

export const extractAvailableDeepSeekModels = (
  response: DeepSeekModelListResponse
): string[] => {
  const modelIds = new Set<string>()

  for (const model of response.data ?? []) {
    const modelId = model.id?.trim()

    if (modelId) {
      modelIds.add(modelId)
    }
  }

  return filterTextModelIds([...modelIds]).sort()
}

const getDeepSeekErrorMessage = async (response: Response): Promise<string> => {
  try {
    const data = (await response.json()) as DeepSeekErrorResponse
    const message = data.error?.message?.trim()

    if (message) {
      return `Unable to load DeepSeek models (${response.status}): ${message}`
    }
  } catch {
    return `Unable to load DeepSeek models (${response.status}).`
  }

  return `Unable to load DeepSeek models (${response.status}).`
}

export const listDeepSeekModelsWithApiKey = async (apiKey: string): Promise<string[]> => {
  const response = await fetch(DEEPSEEK_MODELS_ENDPOINT, {
    headers: {
      [AUTHORIZATION_HEADER]: `Bearer ${apiKey}`
    }
  })

  if (!response.ok) {
    throw new Error(await getDeepSeekErrorMessage(response))
  }

  const data = (await response.json()) as DeepSeekModelListResponse

  if (!Array.isArray(data.data)) {
    throw new Error('DeepSeek model list response is invalid.')
  }

  const models = extractAvailableDeepSeekModels(data)

  return models.length > 0
    ? models
    : filterTextModelIds(DEFAULT_MODEL_OPTIONS_BY_PROVIDER.deepseek)
}

export const listDeepSeekModels = async (apiKeyOverride?: string): Promise<string[]> => {
  const apiKey =
    apiKeyOverride?.trim() ||
    (await getStoredProviderApiKey('deepseek')) ||
    getEnvironmentProviderApiKey('deepseek')

  if (!apiKey) {
    return filterTextModelIds(DEFAULT_MODEL_OPTIONS_BY_PROVIDER.deepseek)
  }

  return listDeepSeekModelsWithApiKey(apiKey)
}
