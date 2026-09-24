import { afterEach, expect, it, vi } from 'vitest'
import { MAX_REVIEW_DRAFT_CHARACTERS, MAX_REVIEW_DRAFTS, REVIEW_DRAFT_TTL_MS, ReviewDraftCache } from './review-draft-cache'
import type { RouterClassification } from '../shared/router'

const classification: RouterClassification = {
  inputType: 'word', structureType: 'single_word', targetText: 'rain', targets: ['rain'],
  focusText: '', intent: 'explain_meaning', modules: ['meaning'], confidence: 1,
  needsClarification: false, clarificationQuestion: '', responseMode: 'card'
}

it('ties immutable route metadata to the draft lifetime and original inputs', () => {
  vi.useFakeTimers()
  const cache = new ReviewDraftCache()
  const route = { fingerprint: 'inputs', classification: structuredClone(classification) }
  cache.put('id', 'draft-key', 'draft', route)
  route.classification.targets.push('mutated')
  const read = cache.getClassification('id', 'inputs')!
  expect(read).toEqual(classification)
  read.modules.push('examples')
  expect(cache.getClassification('id', 'inputs')).toEqual(classification)
  expect(cache.getClassification('other-session', 'inputs')).toBeUndefined()
  expect(cache.take('id', 'draft-key')).toBe('draft')
  expect(cache.getClassification('id', 'inputs')).toBeUndefined()
  cache.put('id', 'draft-key', 'draft', { fingerprint: 'inputs', classification })
  expect(cache.getClassification('id', 'changed')).toBeUndefined()
  expect(cache.take('id', 'draft-key')).toBeUndefined()
  cache.put('id', 'draft-key', 'draft', { fingerprint: 'inputs', classification })
  vi.advanceTimersByTime(REVIEW_DRAFT_TTL_MS)
  expect(cache.getClassification('id', 'inputs')).toBeUndefined()
  expect(vi.getTimerCount()).toBe(0)
})

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

it('consumes only once and rejects mismatched fingerprints', () => {
  vi.useFakeTimers()
  const cache = new ReviewDraftCache()
  cache.put('first', 'match', 'draft')
  expect(cache.take('first', 'other')).toBeUndefined()
  expect(cache.take('first', 'match')).toBeUndefined()
  cache.put('next', 'match', 'draft')
  expect(cache.take('next', 'match')).toBe('draft')
  expect(cache.take('next', 'match')).toBeUndefined()
})

it('expires, bounds entry count and refuses oversized drafts', () => {
  vi.useFakeTimers()
  const cache = new ReviewDraftCache()
  for (let index = 0; index <= MAX_REVIEW_DRAFTS; index++) cache.put(String(index), 'key', 'draft')
  expect(cache.take('0', 'key')).toBeUndefined()
  expect(cache.take(String(MAX_REVIEW_DRAFTS), 'key')).toBe('draft')
  cache.put('oversized', 'key', 'x'.repeat(MAX_REVIEW_DRAFT_CHARACTERS + 1))
  expect(cache.take('oversized', 'key')).toBeUndefined()
  vi.advanceTimersByTime(REVIEW_DRAFT_TTL_MS)
  expect(cache.take('1', 'key')).toBeUndefined()
  expect(vi.getTimerCount()).toBe(0)
})

it('replacing an entry cancels the old expiry timer', () => {
  vi.useFakeTimers()
  const cache = new ReviewDraftCache()
  cache.put('id', 'key', 'old')
  vi.advanceTimersByTime(REVIEW_DRAFT_TTL_MS / 2)
  cache.put('id', 'key', 'new')
  vi.advanceTimersByTime(REVIEW_DRAFT_TTL_MS / 2)
  expect(cache.take('id', 'key')).toBe('new')
  expect(vi.getTimerCount()).toBe(0)
})
