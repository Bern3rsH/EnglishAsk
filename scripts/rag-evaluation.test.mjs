import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { evaluateRetrievalRun, loadEvaluationDataset, validateEvaluationDataset } from './rag-evaluation.mjs'

const { dataset, corpus } = await loadEvaluationDataset()
const usedForm = { noteId: 'used-to.md', text: '结构：used to + 动词原形。' }
const usedMeaning = { noteId: 'used-to.md', text: 'used to 表示过去经常发生的动作或过去存在的状态，通常暗示现在已经不同。' }
const beMeaning = { noteId: 'be-used-to.md', text: 'be used to 表示已经习惯某件事或某种情况。' }
const distractor = { noteId: 'present-perfect.md', text: '结构：have/has + 过去分词。' }
const run = (overrides = {}) => evaluateRetrievalRun({ dataset, corpus, results: [
  { caseId: 'dev-exact-form', hits: [usedForm], retrievalDurationMs: 2 },
  { caseId: 'dev-comparison', hits: [usedMeaning, beMeaning], retrievalDurationMs: 4 },
  { caseId: 'dev-no-evidence', hits: [], retrievalDurationMs: 6 }
], ...overrides })

test('validates the versioned four-note corpus with three cases per split', () => {
  assert.equal(corpus.size, 4)
  assert.equal(dataset.cases.filter(item => item.split === 'development').length, 3)
  assert.equal(dataset.cases.filter(item => item.split === 'heldout').length, 3)
  assert.equal(dataset.cases.filter(item => !item.answerable).length, 2)
})

test('scores deliberately constructed perfect results without counting unanswerable cases as recall successes', () => {
  const report = run()
  assert.equal(report.meanRecallAtK, 1)
  assert.equal(report.meanReciprocalRankAtK, 1)
  assert.equal(report.completeEvidenceRateAtK, 1)
  assert.equal(report.emptyResultRateOnUnanswerable, 1)
  assert.equal(report.meanRetrievalDurationMs, 4)
  assert.equal(report.cases[2].recallAtK, null)
  assert.equal(report.cases[2].reciprocalRankAtK, null)
})

test('measures missing comparison evidence, rank and the top-k boundary independently', () => {
  const results = [
    { caseId: 'dev-exact-form', hits: [distractor, usedForm], retrievalDurationMs: 2 },
    { caseId: 'dev-comparison', hits: [distractor, usedMeaning, beMeaning], retrievalDurationMs: 4 },
    { caseId: 'dev-no-evidence', hits: [distractor], retrievalDurationMs: 6 }
  ]
  const report = run({ results, topK: 2 })
  assert.equal(report.cases[1].recallAtK, 0.5)
  assert.deepEqual(report.cases[1].missingEvidenceIds, ['be-used-to-meaning'])
  assert.equal(report.meanRecallAtK, 0.75)
  assert.equal(report.meanReciprocalRankAtK, 0.5)
  assert.equal(report.completeEvidenceRateAtK, 0.5)
  assert.equal(report.emptyResultRateOnUnanswerable, 0)
  assert.equal(run({ results, topK: 3 }).meanRecallAtK, 1)
})

test('finding the correct note with the wrong passage does not count as evidence', () => {
  const report = run({ results: [
    { caseId: 'dev-exact-form', hits: [usedMeaning], retrievalDurationMs: 0 },
    { caseId: 'dev-comparison', hits: [], retrievalDurationMs: 0 },
    { caseId: 'dev-no-evidence', hits: [], retrievalDurationMs: 0 }
  ] })
  assert.equal(report.meanRecallAtK, 0)
  assert.equal(report.meanReciprocalRankAtK, 0)
  assert.equal(report.cases[0].allEvidenceFoundAtK, false)
})

test('duplicate hits do not inflate recall and still occupy ranking positions', () => {
  const report = run({ topK: 2, results: [
    { caseId: 'dev-exact-form', hits: [usedForm, usedForm], retrievalDurationMs: 0 },
    { caseId: 'dev-comparison', hits: [usedMeaning, usedMeaning, beMeaning], retrievalDurationMs: 0 },
    { caseId: 'dev-no-evidence', hits: [], retrievalDurationMs: 0 }
  ] })
  assert.equal(report.cases[0].recallAtK, 1)
  assert.equal(report.cases[1].recallAtK, 0.5)
  assert.deepEqual(report.cases[1].matchedEvidenceIds, ['used-to-meaning'])
})

test('two evidence passages in one note are measured separately and whitespace is normalized', () => {
  const report = run({ split: 'heldout', results: [
    { caseId: 'holdout-paraphrase', hits: [{ noteId: 'be-used-to.md',
      text: 'I am used to getting up early.\r\n我已经习惯早起。' }], retrievalDurationMs: 0 },
    { caseId: 'holdout-cross-language', hits: [{ noteId: 'get-used-to.md',
      text: 'She is getting used to working at night.' }], retrievalDurationMs: 0 },
    { caseId: 'holdout-no-evidence', hits: [], retrievalDurationMs: 0 }
  ] })
  assert.equal(report.cases[0].recallAtK, 1)
  assert.equal(report.cases[1].recallAtK, 0.5)
  assert.deepEqual(report.cases[1].missingEvidenceIds, ['get-used-to-meaning'])
})

test('unavailable metric groups are null rather than fabricated perfect scores', () => {
  const answerableOnly = { ...dataset, cases: [dataset.cases[0]] }
  assert.equal(run({ dataset: answerableOnly, results: [
    { caseId: 'dev-exact-form', hits: [], retrievalDurationMs: 0 }
  ] }).emptyResultRateOnUnanswerable, null)
  const unanswerableOnly = { ...dataset, cases: [dataset.cases[2]] }
  assert.equal(run({ dataset: unanswerableOnly, results: [
    { caseId: 'dev-no-evidence', hits: [], retrievalDurationMs: 0 }
  ] }).meanRecallAtK, null)
})

for (const topK of [0, -1, 1.5, 101, NaN, Infinity]) {
  test(`rejects invalid top-k: ${topK}`, () => assert.throws(() => run({ topK }), /topK/))
}

for (const [name, mutate, message] of [
  ['unsupported version', value => { value.version = 2 }, /version/],
  ['duplicate notes', value => { value.notes.push(value.notes[0]) }, /unique/],
  ['unsafe path', value => { value.notes[0] = '../outside.md' }, /filename/],
  ['duplicate case IDs', value => { value.cases[1].id = value.cases[0].id }, /unique/],
  ['unknown split', value => { value.cases[0].split = 'training' }, /split/],
  ['empty query', value => { value.cases[0].query = ' ' }, /query/],
  ['contradictory answerability', value => { value.cases[0].answerable = false }, /Answerability/],
  ['unknown evidence note', value => { value.cases[0].evidence[0].noteId = 'missing.md' }, /listed/],
  ['fabricated evidence', value => { value.cases[0].evidence[0].quote = 'Invented evidence' }, /source note/],
  ['duplicate evidence', value => { value.cases[0].evidence.push(value.cases[0].evidence[0]) }, /unique/],
  ['empty expected answer', value => { value.cases[0].answerPoints = [] }, /answer points/]
]) {
  test(`rejects dataset with ${name}`, () => {
    const invalid = structuredClone(dataset)
    mutate(invalid)
    assert.throws(() => validateEvaluationDataset(invalid, corpus), message)
  })
}

test('rejects ambiguous source quotes that occur twice', () => {
  const ambiguousCorpus = new Map(corpus)
  ambiguousCorpus.set('used-to.md', corpus.get('used-to.md') + '\n' + usedForm.text)
  assert.throws(() => validateEvaluationDataset(dataset, ambiguousCorpus), /one occurrence/)
})

test('rejects missing, duplicated, or mixed-split results', () => {
  assert.throws(() => run({ results: [] }), /Every selected case/)
  assert.throws(() => run({ results: [
    { caseId: 'dev-exact-form', hits: [], retrievalDurationMs: 0 },
    { caseId: 'dev-exact-form', hits: [], retrievalDurationMs: 0 }
  ] }), /Duplicate/)
  assert.throws(() => run({ results: [
    { caseId: 'holdout-no-evidence', hits: [], retrievalDurationMs: 0 }
  ] }), /requested split/)
  assert.throws(() => run({ split: 'unknown' }), /split/)
})

test('rejects invented source IDs, fabricated excerpts, and invalid timing', () => {
  for (const [hit, duration, message] of [
    [{ noteId: 'missing.md', text: usedForm.text }, 0, /corpus note/],
    [{ noteId: 'used-to.md', text: 'Invented source content' }, 0, /actual excerpt/],
    [{ noteId: 'used-to.md', text: '' }, 0, /nonempty/],
    [usedForm, -1, /duration/],
    [usedForm, Infinity, /duration/],
    [usedForm, '2', /duration/]
  ]) {
    assert.throws(() => run({ results: [
      { caseId: 'dev-exact-form', hits: [hit], retrievalDurationMs: duration }
    ] }), message)
  }
})

test('loader rejects traversal before reading and refuses symbolic-link fixture notes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'englishask-rag-evaluation-'))
  try {
    const invalid = structuredClone(dataset)
    invalid.notes = ['../outside.md']
    await writeFile(join(directory, 'dataset.json'), JSON.stringify(invalid))
    await assert.rejects(loadEvaluationDataset(directory), /filename/)
    await mkdir(join(directory, 'notes'))
    await writeFile(join(directory, 'dataset.json'), JSON.stringify(dataset))
    const outsidePath = join(directory, 'outside.md')
    await writeFile(outsidePath, corpus.get('used-to.md'))
    await symlink(outsidePath, join(directory, 'notes', 'used-to.md'))
    await assert.rejects(loadEvaluationDataset(directory), /regular file/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('CLI validates fixtures without reporting retrieval accuracy or calling a model', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['scripts/rag-evaluation.mjs', '--validate'],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' }))
  assert.deepEqual(result, { status: 'validated', datasetVersion: 1, noteCount: 4,
    developmentCaseCount: 3, heldoutCaseCount: 3, retrievalImplemented: false, generationEvaluated: false })
})

test('CLI scores a recorded run and rejects invalid input with a nonzero exit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'englishask-rag-run-'))
  try {
    const resultsPath = join(directory, 'results.json')
    await writeFile(resultsPath, JSON.stringify([
      { caseId: 'dev-exact-form', hits: [usedForm], retrievalDurationMs: 2 },
      { caseId: 'dev-comparison', hits: [usedMeaning], retrievalDurationMs: 4 },
      { caseId: 'dev-no-evidence', hits: [], retrievalDurationMs: 6 }
    ]))
    const report = JSON.parse(execFileSync(process.execPath,
      ['scripts/rag-evaluation.mjs', '--results', resultsPath, '--top-k', '3'],
      { cwd: new URL('..', import.meta.url), encoding: 'utf8' }))
    assert.equal(report.meanRecallAtK, 0.75)
    assert.equal(report.completeEvidenceRateAtK, 0.5)
    assert.throws(() => execFileSync(process.execPath,
      ['scripts/rag-evaluation.mjs', '--results', resultsPath, '--top-k', '3x'],
      { cwd: new URL('..', import.meta.url), stdio: 'pipe' }), error => error.status === 1)
    await writeFile(resultsPath, '{invalid json')
    assert.throws(() => execFileSync(process.execPath, ['scripts/rag-evaluation.mjs', '--results', resultsPath],
      { cwd: new URL('..', import.meta.url), stdio: 'pipe' }), error => error.status === 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
