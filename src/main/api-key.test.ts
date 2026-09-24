import { describe, expect, it } from 'vitest'
import { resolveGeminiApiKey } from './api-key'

describe('resolveGeminiApiKey', () => {
  it('prefers the in-app key over the environment key', () => {
    expect(resolveGeminiApiKey('stored-key', 'environment-key')).toBe('stored-key')
  })

  it('falls back to the environment key', () => {
    expect(resolveGeminiApiKey(undefined, 'environment-key')).toBe('environment-key')
  })

  it('returns undefined when no key is configured', () => {
    expect(resolveGeminiApiKey(undefined, undefined)).toBeUndefined()
  })
})
