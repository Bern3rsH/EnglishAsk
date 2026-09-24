import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL_PROVIDER } from '../shared/ai'
import { isModelProvider, normalizeModelProvider } from './model-provider'

describe('model provider settings', () => {
  it('accepts Google Gemini as the default provider', () => {
    expect(isModelProvider(DEFAULT_MODEL_PROVIDER)).toBe(true)
    expect(normalizeModelProvider('google-gemini')).toBe('google-gemini')
  })

  it('accepts configured text model providers', () => {
    expect(normalizeModelProvider('openai')).toBe('openai')
    expect(normalizeModelProvider('deepseek')).toBe('deepseek')
    expect(normalizeModelProvider('openrouter')).toBe('openrouter')
    expect(normalizeModelProvider('anthropic')).toBe('anthropic')
  })

  it('uses Google Gemini when no provider is stored yet', () => {
    expect(normalizeModelProvider(undefined)).toBe(DEFAULT_MODEL_PROVIDER)
  })

  it('rejects unsupported providers', () => {
    expect(isModelProvider('bailian')).toBe(false)
    expect(() => normalizeModelProvider('bailian')).toThrow('Model provider is not supported.')
    expect(isModelProvider('unknown')).toBe(false)
    expect(() => normalizeModelProvider('unknown')).toThrow('Model provider is not supported.')
  })
})
