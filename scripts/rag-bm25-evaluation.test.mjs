import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { evaluateRetrievalRun, loadEvaluationDataset } from './rag-evaluation.mjs'
import { evaluateBm25Dataset } from './rag-bm25-evaluation.mjs'

const { dataset, corpus } = await loadEvaluationDataset()
const withoutTiming = results => results.map(({ retrievalDurationMs, ...result }) => result)

test('runs actual BM25 on all four notes and passes real source excerpts to the evaluator', () => {
  const output = evaluateBm25Dataset({ dataset, corpus })
  assert.equal(output.method, 'bm25')
  assert.equal(output.chunkCount, 12)
  assert.equal(output.generationEvaluated, false)
  assert.equal(output.results.length, 3)
  assert.deepEqual(output.report, evaluateRetrievalRun({ dataset, corpus, results: output.results }))
  assert(output.results.every(result => Number.isFinite(result.retrievalDurationMs) && result.retrievalDurationMs >= 0))
  assert(output.diagnostics.every(item => item.selectedChunks.length <= 3))
})

test('captures the comparison failure rather than treating one relevant first hit as complete evidence', () => {
  const output = evaluateBm25Dataset({ dataset, corpus })
  const comparison = output.report.cases.find(item => item.caseId === 'dev-comparison')
  assert.equal(comparison.reciprocalRankAtK, 1)
  assert.equal(comparison.recallAtK, 0.5)
  assert.equal(comparison.allEvidenceFoundAtK, false)
  assert.deepEqual(comparison.missingEvidenceIds, ['used-to-meaning'])
  const diagnostic = output.diagnostics.find(item => item.caseId === 'dev-comparison')
  assert(diagnostic.selectedChunks.every(chunk => chunk.noteId === 'be-used-to.md'))
})

test('keeps development and heldout runs separate unless all is explicitly requested', () => {
  const development = evaluateBm25Dataset({ dataset, corpus })
  const heldout = evaluateBm25Dataset({ dataset, corpus, split: 'heldout' })
  const all = evaluateBm25Dataset({ dataset, corpus, split: 'all' })
  assert(development.results.every(item => item.caseId.startsWith('dev-')))
  assert(heldout.results.every(item => item.caseId.startsWith('holdout-')))
  assert.equal(heldout.results.length, 3)
  assert.equal(all.results.length, 6)
  assert.equal(all.report.split, 'all')
})

test('changing expected evidence changes evaluation but cannot influence retrieved passages', () => {
  const changedDataset = structuredClone(dataset)
  const comparison = changedDataset.cases.find(item => item.id === 'dev-comparison')
  comparison.evidence = comparison.evidence.filter(item => item.noteId === 'be-used-to.md')
  const original = evaluateBm25Dataset({ dataset, corpus })
  const changed = evaluateBm25Dataset({ dataset: changedDataset, corpus })
  assert.deepEqual(withoutTiming(original.results), withoutTiming(changed.results))
  assert.deepEqual(original.diagnostics, changed.diagnostics)
  assert.notEqual(original.report.meanRecallAtK, changed.report.meanRecallAtK)
})

test('top-k limits recorded hits without changing the ranking of shared candidates', () => {
  const one = evaluateBm25Dataset({ dataset, corpus, topK: 1 })
  const three = evaluateBm25Dataset({ dataset, corpus, topK: 3 })
  for (const result of one.results) {
    assert(result.hits.length <= 1)
    assert.deepEqual(result.hits, three.results.find(item => item.caseId === result.caseId).hits.slice(0, 1))
  }
  assert.equal(one.report.topK, 1)
})

test('records empty results for unanswered cases instead of omitting them', () => {
  const output = evaluateBm25Dataset({ dataset, corpus })
  assert.deepEqual(output.results.find(item => item.caseId === 'dev-no-evidence').hits, [])
  assert.equal(output.report.cases.find(item => item.caseId === 'dev-no-evidence').noEvidenceEmptyResult, true)
})

test('rejects invalid split and top-k before reporting a run', () => {
  assert.throws(() => evaluateBm25Dataset({ dataset, corpus, split: 'unknown' }), /split/)
  for (const topK of [0, -1, 1.5, NaN, 101]) {
    assert.throws(() => evaluateBm25Dataset({ dataset, corpus, topK }), /top-k/)
  }
})

test('CLI defaults to development, prints diagnostics without raw passages and rejects invalid input', () => {
  const scriptPath = fileURLToPath(new URL('./rag-bm25-evaluation.mjs', import.meta.url))
  const run = args => spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' })
  const successful = run([])
  assert.equal(successful.status, 0)
  const output = JSON.parse(successful.stdout)
  assert.equal(output.report.split, 'development')
  assert.equal(output.results, undefined)
  assert(output.diagnostics.every(item => item.selectedChunks.every(chunk => chunk.text === undefined)))
  const invalid = run(['--top-k', '0'])
  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /top-k/)
  assert.equal(invalid.stdout, '')
})
