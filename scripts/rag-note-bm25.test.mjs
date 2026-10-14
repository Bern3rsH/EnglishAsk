import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadSampleChunks } from './rag-note-demo.mjs'
import { retrieveChunksWithBm25, tokenizeChunkText } from './rag-note-bm25.mjs'

test('document tokenization retains repetitions and normalizes case without punctuation', () => {
  assert.deepEqual(tokenizeChunkText('习惯，习惯！ USED TO'), ['习惯', '习惯', 'used', 'to'])
  assert.deepEqual(tokenizeChunkText(' \n？！'), [])
  assert.throws(() => tokenizeChunkText(null), /text/)
})

test('retrieves real sample passages with original sources and descending BM25 scores', async () => {
  const chunks = await loadSampleChunks()
  const before = structuredClone(chunks)
  const result = retrieveChunksWithBm25(chunks, '我的笔记中有关习惯的笔记有哪些？')
  assert.deepEqual(result.queryTerms, ['习惯'])
  assert.equal(result.candidateCount, 2)
  assert.equal(result.matches.length, 2)
  assert(result.matches.every(chunk => chunk.source === 'be-used-to.md' && chunk.text.includes('习惯')))
  assert(result.matches[0].score >= result.matches[1].score)
  for (const match of result.matches) {
    assert(chunks.some(chunk => chunk.source === match.source && chunk.title === match.title && chunk.text === match.text))
    assert(result.context.includes(match.text))
    assert(result.context.includes(`来源: ${match.source}`))
  }
  assert.deepEqual(chunks, before)
})

test('top-k is applied after scoring the entire corpus and does not pad results', async () => {
  const chunks = await loadSampleChunks()
  const all = retrieveChunksWithBm25(chunks, '习惯', 10)
  const limited = retrieveChunksWithBm25(chunks, '习惯', 1)
  assert.equal(all.matches.length, 2)
  assert.equal(limited.candidateCount, 2)
  assert.deepEqual(limited.matches, all.matches.slice(0, 1))
  assert(limited.context.includes(limited.matches[0].text))
  assert(!limited.context.includes(`标题: ${all.matches[1].title}`))
})

test('token matching does not treat part of an English word as a full term', () => {
  const chunks = [{ source: 'note.md', title: 'used to', text: 'used' }]
  assert.equal(retrieveChunksWithBm25(chunks, 'used').matches.length, 1)
  assert.equal(retrieveChunksWithBm25(chunks, 'use').matches.length, 0)
})

test('unknown literal synonyms, empty questions and empty corpora return empty context', async () => {
  const chunks = await loadSampleChunks()
  for (const question of ['适应', '', '我的笔记有哪些？']) {
    const result = retrieveChunksWithBm25(chunks, question)
    assert.equal(result.candidateCount, 0)
    assert.deepEqual(result.matches, [])
    assert.equal(result.context, '')
  }
  assert.deepEqual(retrieveChunksWithBm25([], '习惯').matches, [])
})

test('same-title chunks remain distinct and retain deterministic source order on ties', () => {
  const chunks = [
    { source: 'note.md', title: '含义', text: '习惯' },
    { source: 'note.md', title: '含义', text: '习惯' }
  ]
  const matches = retrieveChunksWithBm25(chunks, '习惯').matches
  assert.deepEqual(matches.map(chunk => chunk.id), ['chunk-1', 'chunk-2'])
})

test('rejects invalid top-k and input contracts', () => {
  for (const topK of [0, -1, 1.5, 101, NaN, Infinity]) {
    assert.throws(() => retrieveChunksWithBm25([], '习惯', topK), /top-k/)
  }
  assert.throws(() => retrieveChunksWithBm25(null, '习惯'), /array/)
  assert.throws(() => retrieveChunksWithBm25([{}], '习惯'), /chunk/)
  assert.throws(() => retrieveChunksWithBm25([], null), /Question/)
})

test('CLI accepts a complete question and top-k and rejects invalid limits', () => {
  const scriptPath = fileURLToPath(new URL('./rag-note-bm25.mjs', import.meta.url))
  const run = args => spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' })
  const successful = run(['我的笔记中有关习惯的笔记有哪些？', '1'])
  assert.equal(successful.status, 0)
  const result = JSON.parse(successful.stdout)
  assert.equal(result.chunkCount, 6)
  assert.equal(result.matches.length, 1)
  assert.equal(result.candidateCount, 2)
  assert.equal(result.generationCalled, false)
  const invalid = run(['习惯', '0'])
  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /top-k/)
  assert.equal(invalid.stdout, '')
})
