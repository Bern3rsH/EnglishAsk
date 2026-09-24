import { describe, expect, it } from 'vitest'
import {
  getDefaultSystemPrompt,
  LEGACY_ENGLISH_ASK_SYSTEM_PROMPTS,
  MAX_SYSTEM_PROMPT_CHARACTERS,
  normalizeStoredSystemPrompt,
  normalizeSystemPrompt
} from './prompt'

describe('system prompt settings', () => {
  it('exposes the default system prompt', () => {
    expect(getDefaultSystemPrompt()).toContain('EnglishAsk')
    expect(getDefaultSystemPrompt()).toContain('complete, learner-focused answer')
    expect(getDefaultSystemPrompt()).toContain('two or three varied examples')
    expect(getDefaultSystemPrompt()).not.toContain('concise English learning assistant')
  })

  it('normalizes custom prompts', () => {
    expect(normalizeSystemPrompt('  Reply concisely.  ')).toBe('Reply concisely.')
  })

  it('rejects empty prompts', () => {
    expect(() => normalizeSystemPrompt('   ')).toThrow('System prompt cannot be empty.')
  })

  it('rejects oversized prompts', () => {
    expect(() => normalizeSystemPrompt('a'.repeat(MAX_SYSTEM_PROMPT_CHARACTERS + 1))).toThrow(
      `System prompt must be ${MAX_SYSTEM_PROMPT_CHARACTERS} characters or fewer.`
    )
  })

  it('migrates known concise defaults without replacing custom prompts', () => {
    for (const legacyPrompt of LEGACY_ENGLISH_ASK_SYSTEM_PROMPTS) {
      expect(normalizeStoredSystemPrompt(legacyPrompt)).toBe(getDefaultSystemPrompt())
    }

    expect(normalizeStoredSystemPrompt('  Use my custom teaching style.  ')).toBe(
      'Use my custom teaching style.'
    )
  })
})
