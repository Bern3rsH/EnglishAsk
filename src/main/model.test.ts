import { describe, expect, it } from 'vitest'
import { DEFAULT_GEMINI_MODEL } from './ai-request'
import { isGeminiModel, normalizeGeminiModel } from './model'

describe('Gemini model settings', () => {
  it('accepts the default model', () => {
    expect(isGeminiModel(DEFAULT_GEMINI_MODEL)).toBe(true)
  })

  it('normalizes model ids', () => {
    expect(normalizeGeminiModel('gemini-2.5-flash')).toBe('gemini-2.5-flash')
  })

  it('normalizes Gemini API names', () => {
    expect(normalizeGeminiModel('models/gemini-2.5-flash')).toBe('gemini-2.5-flash')
  })

  it('rejects empty models', () => {
    expect(() => normalizeGeminiModel('   ')).toThrow('Gemini model cannot be empty.')
  })

  it('rejects whitespace inside model ids', () => {
    expect(() => normalizeGeminiModel('gemini 2.5 flash')).toThrow(
      'Gemini model cannot contain whitespace.'
    )
  })
})
