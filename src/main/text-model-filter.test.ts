import { describe, expect, it } from 'vitest'
import { filterTextModelIds, isTextModelId } from './text-model-filter'

describe('isTextModelId', () => {
  it('accepts provider-neutral text model ids', () => {
    expect(isTextModelId('gemini-3.5-flash')).toBe(true)
    expect(isTextModelId('gemini-3.1-pro-preview')).toBe(true)
    expect(isTextModelId('gpt-4.1')).toBe(true)
    expect(isTextModelId('claude-3-5-sonnet-latest')).toBe(true)
    expect(isTextModelId('deepseek-chat')).toBe(true)
  })

  it('rejects provider-neutral non-text model ids', () => {
    expect(isTextModelId('gemini-3-pro-image')).toBe(false)
    expect(isTextModelId('gemini-3.1-flash-tts-preview')).toBe(false)
    expect(isTextModelId('text-embedding-004')).toBe(false)
    expect(isTextModelId('gpt-4o-audio-preview')).toBe(false)
    expect(isTextModelId('dall-e-3')).toBe(false)
    expect(isTextModelId('whisper-1')).toBe(false)
    expect(isTextModelId('claude-3-opus-vision')).toBe(false)
  })
})

describe('filterTextModelIds', () => {
  it('keeps only text model ids from mixed provider lists', () => {
    expect(
      filterTextModelIds([
        'gemini-2.5-flash',
        'gemini-3-pro-image',
        'gpt-4.1',
        'gpt-4o-audio-preview',
        'claude-3-5-sonnet-latest',
        'text-embedding-004'
      ])
    ).toEqual(['gemini-2.5-flash', 'gpt-4.1', 'claude-3-5-sonnet-latest'])
  })
})
