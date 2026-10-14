import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import { evaluateBm25Dataset } from './rag-bm25-evaluation.mjs'
import { evaluateRetrievalRun, loadEvaluationDataset } from './rag-evaluation.mjs'
import { splitNoteIntoChunks } from './rag-note-demo.mjs'
import { extractQueryKeywords } from './rag-query-demo.mjs'
import {
  collectNoteTopics, extractQueryTermsWithTopics, retrieveChunksWithPhraseBm25,
  tokenizeChunkWithTopics
} from './rag-phrase-bm25.mjs'

const TOPICS = ['used to', 'be used to', 'get used to']

test('matches the longest topic without adding its nested expression', () => {
  assert.deepEqual(tokenizeChunkWithTopics('be used to 和 used to', TOPICS),
    ['be used to', '和', 'used to'])
  assert.deepEqual(tokenizeChunkWithTopics('get used to', TOPICS), ['get used to'])
})

test('normalizes casing and whitespace in both text and topics', () => {
  assert.deepEqual(tokenizeChunkWithTopics('BE   USED\nTO', ['Be Used To']), ['be used to'])
})

test('checks English word boundaries while allowing adjacent Chinese', () => {
  const tokens = tokenizeChunkWithTopics('unused to; used today; used to表示过去', TOPICS)
  assert.equal(tokens.filter(token => token === 'used to').length, 1)
  assert.ok(tokens.includes('unused'))
  assert.ok(tokens.includes('today'))
})

test('handles literal punctuation in topics without regex interpretation', () => {
  assert.deepEqual(tokenizeChunkWithTopics('C++ 和 a.b', ['C++', 'a.b']), ['c++', '和', 'a.b'])
})

test('retains document repetitions but deduplicates question terms', () => {
  assert.deepEqual(tokenizeChunkWithTopics('used to used to', TOPICS), ['used to', 'used to'])
  assert.deepEqual(extractQueryTermsWithTopics('我的笔记中 used to used to', TOPICS), ['used to'])
})

test('keeps existing query segmentation when no topic matches', () => {
  const question = '我的笔记中有关习惯的笔记有哪些？'
  assert.deepEqual(extractQueryTermsWithTopics(question, TOPICS), extractQueryKeywords(question))
  assert.deepEqual(tokenizeChunkWithTopics('', []), [])
})

test('derives a deduplicated vocabulary from chunk topics', () => {
  const chunks = ['Used To / 含义', 'used to / 结构', 'be used to / 含义']
    .map(title => ({ source: 'note.md', title, text: '' }))
  assert.deepEqual(collectNoteTopics(chunks), ['used to', 'be used to'])
})

test('rejects invalid inputs and handles empty retrieval', () => {
  assert.throws(() => tokenizeChunkWithTopics(null, TOPICS))
  assert.throws(() => tokenizeChunkWithTopics('text', ['']))
  assert.throws(() => collectNoteTopics([null]))
  assert.throws(() => retrieveChunksWithPhraseBm25([], 'used to', 0))
  assert.throws(() => retrieveChunksWithPhraseBm25([], null))
  assert.deepEqual(retrieveChunksWithPhraseBm25([], 'used to').matches, [])
})

test('recovers both comparison passages on development cases with unchanged top-k', async () => {
  const { dataset, corpus } = await loadEvaluationDataset()
  const chunks = dataset.notes.flatMap(noteId => splitNoteIntoChunks(corpus.get(noteId), noteId))
  const originalChunks = structuredClone(chunks)
  const results = dataset.cases.filter(item => item.split === 'development').map(item => {
    const start = performance.now()
    const retrieval = retrieveChunksWithPhraseBm25(chunks, item.query, 3)
    return { caseId: item.id, hits: retrieval.matches.map(chunk => ({ noteId: chunk.source, text: chunk.text })),
      retrievalDurationMs: performance.now() - start }
  })
  const report = evaluateRetrievalRun({ dataset, corpus, results, topK: 3, split: 'development' })
  const baseline = evaluateBm25Dataset({ dataset, corpus })
  assert.equal(baseline.report.meanRecallAtK, 0.75)
  assert.equal(report.meanRecallAtK, 1)
  assert.equal(report.completeEvidenceRateAtK, 1)
  assert.equal(report.emptyResultRateOnUnanswerable, 1)
  assert.deepEqual(chunks, originalChunks)
  const comparison = dataset.cases.find(item => item.id === 'dev-comparison')
  const retrieval = retrieveChunksWithPhraseBm25(chunks, comparison.query)
  assert.ok(retrieval.queryTerms.includes('used to'))
  assert.ok(retrieval.queryTerms.includes('be used to'))
  assert.ok(!retrieval.queryTerms.includes('be'))
  assert.ok(retrieval.context.includes('来源: used-to.md'))
  assert.ok(retrieval.context.includes('来源: be-used-to.md'))
})

test('CLI runs locally and rejects invalid top-k', () => {
  const entrypoint = new URL('./rag-phrase-bm25.mjs', import.meta.url)
  const success = spawnSync(process.execPath, [entrypoint.pathname], { encoding: 'utf8' })
  assert.equal(success.status, 0, success.stderr)
  const output = JSON.parse(success.stdout)
  assert.equal(output.generationCalled, false)
  assert.equal(output.matches.length, 3)
  const failure = spawnSync(process.execPath, [entrypoint.pathname, 'used to', '0'], { encoding: 'utf8' })
  assert.equal(failure.status, 1)
  assert.match(failure.stderr, /top-k/)
})

test('does not retrieve an unrelated grammar chunk solely through request can wording', () => {
  const chunks = [
    { source: 'present-perfect.md', title: '现在完成时 / 含义', text: '现在完成时可以描述过去发生、与现在有关的动作或情况。' },
    { source: 'get-used-to.md', title: 'get used to / Meaning', text: 'get used to describes the process of becoming familiar or comfortable with something.' }
  ]
  const retrieval = retrieveChunksWithPhraseBm25(chunks, '根据笔记，逐渐适应夜间工作可以用什么表达？')
  assert(!retrieval.queryTerms.includes('可以'))
  assert.deepEqual(retrieval.matches, [])
  assert(tokenizeChunkWithTopics(chunks[0].text, retrieval.topics).includes('可以'))
})

test('keeps a protected note topic named can even when the question also uses request wording', () => {
  const chunks = [{ source: 'can.md', title: '可以 / 含义', text: '表示许可。' }]
  const retrieval = retrieveChunksWithPhraseBm25(chunks, '可以用什么表达？')
  assert(retrieval.queryTerms.includes('可以'))
  assert.equal(retrieval.matches[0].source, 'can.md')
})
