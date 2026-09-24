import { DEFAULT_GEMINI_MODEL_OPTIONS } from '../shared/ai'
import { resolveGeminiApiKey } from './api-key'
import { normalizeGeminiModel } from './model'
import { getStoredGeminiApiKey } from './settings'
import { filterTextModelIds } from './text-model-filter'

const GEMINI_MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
const GEMINI_MODELS_PAGE_SIZE = '1000'
const MAX_GEMINI_MODEL_PAGES = 10
const GENERATE_CONTENT_METHOD = 'generateContent'

interface GeminiModelListItem {
  name?: string
  supportedGenerationMethods?: string[]
}

interface GeminiModelListResponse {
  models?: GeminiModelListItem[]
  nextPageToken?: string
}

interface GeminiErrorResponse {
  error?: {
    message?: string
  }
}

const normalizeModelName = (name: unknown): string | null => {
  if (typeof name !== 'string') {
    return null
  }

  try {
    return normalizeGeminiModel(name)
  } catch {
    return null
  }
}

export const extractGenerativeGeminiModels = (response: GeminiModelListResponse): string[] => {
  const modelIds = new Set<string>()

  for (const model of response.models ?? []) {
    if (!model.supportedGenerationMethods?.includes(GENERATE_CONTENT_METHOD)) {
      continue
    }

    const modelId = normalizeModelName(model.name)

    if (modelId) {
      modelIds.add(modelId)
    }
  }

  return [...modelIds].sort()
}

const getGeminiErrorMessage = async (response: Response): Promise<string> => {
  try {
    const data = (await response.json()) as GeminiErrorResponse
    const message = data.error?.message?.trim()

    if (message) {
      return `Unable to load Gemini models (${response.status}): ${message}`
    }
  } catch {
    return `Unable to load Gemini models (${response.status}).`
  }

  return `Unable to load Gemini models (${response.status}).`
}

const fetchGeminiModelsPage = async (
  apiKey: string,
  pageToken?: string
): Promise<GeminiModelListResponse> => {
  const url = new URL(GEMINI_MODELS_ENDPOINT)
  url.searchParams.set('key', apiKey)
  url.searchParams.set('pageSize', GEMINI_MODELS_PAGE_SIZE)

  if (pageToken) {
    url.searchParams.set('pageToken', pageToken)
  }

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(await getGeminiErrorMessage(response))
  }

  return (await response.json()) as GeminiModelListResponse
}

export const listGeminiModelsWithApiKey = async (apiKey: string): Promise<string[]> => {
  const allModels: GeminiModelListItem[] = []
  let nextPageToken: string | undefined
  let pageCount = 0

  do {
    const data = await fetchGeminiModelsPage(apiKey, nextPageToken)
    allModels.push(...(data.models ?? []))
    nextPageToken = data.nextPageToken?.trim() || undefined
    pageCount += 1
  } while (nextPageToken && pageCount < MAX_GEMINI_MODEL_PAGES)

  if (nextPageToken) {
    throw new Error('Unable to load all Gemini models.')
  }

  const models = filterTextModelIds(extractGenerativeGeminiModels({ models: allModels }))

  return models.length > 0 ? models : filterTextModelIds(DEFAULT_GEMINI_MODEL_OPTIONS)
}

export const listGeminiModels = async (apiKeyOverride?: string): Promise<string[]> => {
  const apiKey =
    apiKeyOverride?.trim() ||
    resolveGeminiApiKey(
      await getStoredGeminiApiKey(),
      process.env.GOOGLE_GENERATIVE_AI_API_KEY
    )

  if (!apiKey) {
    return filterTextModelIds(DEFAULT_GEMINI_MODEL_OPTIONS)
  }

  return listGeminiModelsWithApiKey(apiKey)
}
