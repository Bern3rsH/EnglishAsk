import {
  supportsDynamicModelListing,
  type ListProviderModelsRequest
} from '../shared/ai'
import { listDeepSeekModels } from './deepseek-models'
import { listGeminiModels } from './gemini-models'
import { normalizeModelProvider } from './model-provider'
import { listOpenAICompatibleModels } from './openai-compatible-models'
import { listNativeProviderModels } from './native-provider-models'

const MAX_API_KEY_CHARACTERS = 4096

const assertRecord = (value: unknown): asserts value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Model list request must be an object.')
  }
}

const normalizeOptionalApiKey = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error('Model list API key must be a string.')
  }

  const apiKey = value.trim()

  if (apiKey.length > MAX_API_KEY_CHARACTERS) {
    throw new Error(`Model list API key must be ${MAX_API_KEY_CHARACTERS} characters or fewer.`)
  }

  return apiKey || undefined
}

const validateListProviderModelsRequest = (input: unknown): ListProviderModelsRequest => {
  assertRecord(input)

  const modelProvider = normalizeModelProvider(input.modelProvider)

  if (!supportsDynamicModelListing(modelProvider)) {
    throw new Error('Selected model provider does not support dynamic model listing.')
  }

  return {
    modelProvider,
    apiKey: normalizeOptionalApiKey(input.apiKey)
  }
}

export const listProviderModels = async (input: unknown): Promise<string[]> => {
  const request = validateListProviderModelsRequest(input)

  if (request.modelProvider === 'anthropic') {
    return listNativeProviderModels(request.modelProvider, request.apiKey)
  }

  if (request.modelProvider === 'openai' || request.modelProvider === 'openrouter') {
    return listOpenAICompatibleModels(request.modelProvider, request.apiKey)
  }

  if (request.modelProvider === 'deepseek') {
    return listDeepSeekModels(request.apiKey)
  }

  return listGeminiModels(request.apiKey)
}
