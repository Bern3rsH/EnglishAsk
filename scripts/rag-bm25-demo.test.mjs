import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  calculateIdf, calculateTermScore, rankTokenizedChunks, sampleTokenizedChunks
} from './rag-bm25-demo.mjs'

const NUMERICAL_TOLERANCE = 1e-12
const closeTo = (actual, expected) => assert(Math.abs(actual - expected) < NUMERICAL_TOLERANCE)

test('IDF matches the smoothed formula and rewards rarer terms', () => {
  closeTo(calculateIdf(3, 1), Math.log(8 / 3))
  closeTo(calculateIdf(3, 2), Math.log(1.6))
  assert(calculateIdf(3, 1) > calculateIdf(3, 2))
  assert(calculateIdf(3, 3) > 0)
  assert(Number.isFinite(calculateIdf(3, 0)))
})

test('single occurrence at average length contributes exactly IDF', () => {
  closeTo(calculateTermScore({ idf: 2, termFrequency: 1, chunkLength: 4, averageChunkLength: 4 }), 2)
})

test('repeated terms increase the score with diminishing returns', () => {
  const score = termFrequency => calculateTermScore({
    idf: 1, termFrequency, chunkLength: 100, averageChunkLength: 100
  })
  closeTo(score(2), 1.375)
  assert(score(2) > score(1))
  assert(score(3) - score(2) < score(2) - score(1))
  assert(score(100) < 2.2)
})

test('length normalization favors shorter chunks for otherwise equal evidence', () => {
  const score = (chunkLength, b) => calculateTermScore({
    idf: 1, termFrequency: 2, chunkLength, averageChunkLength: 10, b
  })
  assert(score(5, 0.75) > score(20, 0.75))
  closeTo(score(5, 0), score(20, 0))
})

test('zero frequency returns zero even with zero k1', () => {
  assert.equal(calculateTermScore({
    idf: 1, termFrequency: 0, chunkLength: 0, averageChunkLength: 1, k1: 0
  }), 0)
})

test('breaks the literal-count tie and exposes independently calculated contributions', () => {
  const matches = rankTokenizedChunks(sampleTokenizedChunks, ['倒装句', '用法'])
  assert.deepEqual(matches.map(chunk => chunk.id), ['B', 'A', 'C'])
  assert(matches.every(chunk => chunk.matchedTermCount === 1))
  const expectedB = Math.log(8 / 3) * 4.4 / (2 + 1.2 * (0.25 + 0.75 * 3 / (7 / 3)))
  const expectedA = Math.log(1.6) * 2.2 / (1 + 1.2 * (0.25 + 0.75 * 2 / (7 / 3)))
  closeTo(matches[0].score, expectedB)
  closeTo(matches[1].score, expectedA)
  assert.equal(matches[0].termScores[0].documentFrequency, 1)
  assert.equal(matches[0].termScores[0].termFrequency, 2)
})

test('deduplicates query terms but preserves document term frequencies and source data', () => {
  const before = structuredClone(sampleTokenizedChunks)
  assert.deepEqual(rankTokenizedChunks(sampleTokenizedChunks, ['倒装句', '倒装句']),
    rankTokenizedChunks(sampleTokenizedChunks, ['倒装句']))
  assert.deepEqual(sampleTokenizedChunks, before)
  const matches = rankTokenizedChunks([{ id: 'english', tokens: ['USED', 'used'] }], [' Used '])
  assert.equal(matches[0].termScores[0].termFrequency, 2)
})

test('empty corpus, empty query, empty documents and unknown terms return no results', () => {
  assert.deepEqual(rankTokenizedChunks([], ['倒装句']), [])
  assert.deepEqual(rankTokenizedChunks(sampleTokenizedChunks, []), [])
  assert.deepEqual(rankTokenizedChunks([{ id: 'empty', tokens: [] }], ['倒装句']), [])
  assert.deepEqual(rankTokenizedChunks(sampleTokenizedChunks, ['不存在']), [])
})

test('rejects invalid corpus statistics and parameter ranges', () => {
  assert.throws(() => calculateIdf(0, 0), /Total/)
  assert.throws(() => calculateIdf(3, 4), /Document/)
  assert.throws(() => calculateIdf(3, -1), /Document/)
  assert.throws(() => calculateTermScore({ idf: 1, termFrequency: 1, chunkLength: 1,
    averageChunkLength: 0 }), /Average/)
  assert.throws(() => calculateTermScore({ idf: 1, termFrequency: 2, chunkLength: 1,
    averageChunkLength: 1 }), /Term/)
  assert.throws(() => rankTokenizedChunks([], [], { k1: Infinity }), /k1/)
  assert.throws(() => rankTokenizedChunks([], [], { b: 2 }), /b/)
  assert.throws(() => rankTokenizedChunks([null], []), /ID/)
  assert.throws(() => rankTokenizedChunks([{ id: 'a', tokens: [] }, { id: 'a', tokens: [] }], []), /unique/)
  assert.throws(() => rankTokenizedChunks(sampleTokenizedChunks, ['']), /Tokens/)
})

test('CLI reports ranked scores and accepts explicit pre-tokenized query terms', () => {
  const execute = tokens => JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(new URL('./rag-bm25-demo.mjs', import.meta.url)), ...tokens], { encoding: 'utf8' }))
  assert.deepEqual(execute([]).matches.map(chunk => chunk.id), ['B', 'A', 'C'])
  assert.deepEqual(execute(['用法']).matches.map(chunk => chunk.id), ['A', 'C'])
  assert.deepEqual(execute(['适应']).matches, [])
  assert.equal(execute([]).generationCalled, false)
})
