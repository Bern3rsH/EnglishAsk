import { DEFAULT_MODEL_PROVIDER, MODEL_PROVIDER_OPTIONS, type ModelProvider } from '../shared/ai'

const modelProviderIds = new Set<string>(MODEL_PROVIDER_OPTIONS.map((provider) => provider.id))

export const isModelProvider = (value: unknown): value is ModelProvider => {
  return typeof value === 'string' && modelProviderIds.has(value)
}

export const normalizeModelProvider = (value: unknown): ModelProvider => {
  if (value === undefined) {
    return DEFAULT_MODEL_PROVIDER
  }

  if (!isModelProvider(value)) {
    throw new Error('Model provider is not supported.')
  }

  return value
}
