import { expect, it } from 'vitest'
import { EmbeddingVectorCache, MAX_INDEX_WINDOWS, windowVectorKey } from './embedding-vector-cache'
const vector = Array(1024).fill(1)
it('keys actual inputs independently of sources and distinguishes changed tokens', () => {
  expect(windowVectorKey([1,2,3])).toBe(windowVectorKey([1,2,3]))
  expect(windowVectorKey([1,2,3])).not.toBe(windowVectorKey([1,2,4]))
})
it('scans all references, shares vectors and prunes only after the last reference disappears', () => {
  const cache = new EmbeddingVectorCache()
  cache.commit('directory', new Map([['a',['shared']], ['b',['shared']], ['c',['other']]]), new Map([['shared',vector], ['other',vector]]))
  cache.commit('directory', new Map([['b',['shared']], ['c',['other']]]), new Map())
  expect(cache.get('directory','shared')).toBe(vector)
  cache.commit('directory', new Map([['c',['other']]]), new Map())
  expect(cache.get('directory','shared')).toBeUndefined()
  expect(cache.get('directory','other')).toBe(vector)
  cache.commit('directory', new Map(), new Map())
  expect(cache.get('directory','other')).toBeUndefined()
})
it('isolates directories and failed commits leave the previous snapshot intact', () => {
  const cache = new EmbeddingVectorCache()
  cache.commit('a', new Map([['chunk',['key']]]), new Map([['key',vector]]))
  expect(cache.get('b','key')).toBeUndefined()
  expect(() => cache.commit('b', new Map([['chunk',['key']]]), new Map())).toThrow('missing')
  expect(cache.get('a','key')).toBe(vector)
  expect(() => cache.commit('a', new Map([['chunk',['new']]]), new Map([['new',[NaN]]]))).toThrow('invalid')
  expect(cache.get('a','key')).toBe(vector)
})
it('enforces the bound and does not leak cached inputs after clearing', () => {
  const cache = new EmbeddingVectorCache()
  const tooManyKeys = Array.from({ length: MAX_INDEX_WINDOWS + 1 }, (_, index) => `key-${index}`)
  expect(() => cache.commit('a', new Map([['chunk',tooManyKeys]]), new Map())).toThrow('limit')
  cache.commit('a', new Map([['chunk',['key']]]), new Map([['key',vector]]))
  cache.clear(); expect(cache.get('a','key')).toBeUndefined()
})
