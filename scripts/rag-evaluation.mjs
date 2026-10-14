import assert from 'node:assert/strict'
import { lstat, readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const DATASET_VERSION = 1
export const DEFAULT_TOP_K = 3
export const MAX_TOP_K = 100
export const FIXTURE_DIRECTORY = fileURLToPath(new URL('../tests/fixtures/rag/', import.meta.url))
const VALID_SPLITS = new Set(['development', 'heldout'])
const normalizeWhitespace = text => text.normalize('NFC').replace(/\s+/gu, ' ').trim()
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0
const mean = values => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length

const validateNoteId = noteId => {
  assert(isNonEmptyString(noteId), 'Note ID must be a nonempty string.')
  assert(basename(noteId) === noteId && !/[\\/\x00]/u.test(noteId) && noteId.endsWith('.md'),
    'Note ID must be a local Markdown filename.')
}

export const validateEvaluationDataset = (dataset, corpus) => {
  assert(isRecord(dataset) && dataset.version === DATASET_VERSION, 'Unsupported evaluation dataset version.')
  assert(corpus instanceof Map, 'Evaluation corpus must be a Map.')
  assert(Array.isArray(dataset.notes) && dataset.notes.length > 0, 'Dataset must list its notes.')
  assert(new Set(dataset.notes).size === dataset.notes.length, 'Dataset note IDs must be unique.')
  for (const noteId of dataset.notes) {
    validateNoteId(noteId)
    assert(isNonEmptyString(corpus.get(noteId)), 'Dataset note is missing or empty.')
  }
  assert(corpus.size === dataset.notes.length, 'Corpus must contain exactly the listed notes.')
  assert(Array.isArray(dataset.cases) && dataset.cases.length > 0, 'Dataset must contain evaluation cases.')
  const caseIds = new Set()
  for (const evaluationCase of dataset.cases) {
    assert(isRecord(evaluationCase) && isNonEmptyString(evaluationCase.id), 'Case ID is required.')
    assert(!caseIds.has(evaluationCase.id), 'Case IDs must be unique.')
    caseIds.add(evaluationCase.id)
    assert(VALID_SPLITS.has(evaluationCase.split), 'Case split must be development or heldout.')
    assert(isNonEmptyString(evaluationCase.query), 'Case query is required.')
    assert(typeof evaluationCase.answerable === 'boolean', 'Case answerability must be explicit.')
    assert(Array.isArray(evaluationCase.evidence), 'Case evidence must be an array.')
    assert(evaluationCase.answerable === (evaluationCase.evidence.length > 0),
      'Answerability must agree with annotated evidence.')
    assert(Array.isArray(evaluationCase.answerPoints) && evaluationCase.answerPoints.length > 0 &&
      evaluationCase.answerPoints.every(isNonEmptyString), 'Expected answer points are required.')
    assert(isNonEmptyString(evaluationCase.reason), 'Case rationale is required.')
    const evidenceIds = new Set()
    for (const evidence of evaluationCase.evidence) {
      assert(isRecord(evidence) && isNonEmptyString(evidence.id), 'Evidence ID is required.')
      assert(!evidenceIds.has(evidence.id), 'Evidence IDs within a case must be unique.')
      evidenceIds.add(evidence.id)
      assert(dataset.notes.includes(evidence.noteId), 'Evidence must refer to a listed note.')
      assert(isNonEmptyString(evidence.quote), 'Evidence must contain an exact source quote.')
      const source = normalizeWhitespace(corpus.get(evidence.noteId))
      const quote = normalizeWhitespace(evidence.quote)
      assert(source.includes(quote), 'Evidence quote must occur in its source note.')
      assert(source.indexOf(quote) === source.lastIndexOf(quote),
        'Evidence quote must identify one occurrence in its source note.')
    }
  }
  return dataset
}

export const loadEvaluationDataset = async (fixtureDirectory = FIXTURE_DIRECTORY) => {
  const dataset = JSON.parse(await readFile(join(fixtureDirectory, 'dataset.json'), 'utf8'))
  assert(isRecord(dataset) && Array.isArray(dataset.notes), 'Dataset must list its notes.')
  const corpus = new Map()
  for (const noteId of dataset.notes) {
    validateNoteId(noteId)
    const notePath = join(fixtureDirectory, 'notes', noteId)
    assert((await lstat(notePath)).isFile(), 'Fixture note must be a regular file, not a symlink.')
    corpus.set(noteId, await readFile(notePath, 'utf8'))
  }
  validateEvaluationDataset(dataset, corpus)
  return { dataset, corpus }
}

export const evaluateRetrievalRun = ({ dataset, corpus, results, topK = DEFAULT_TOP_K, split = 'development' }) => {
  validateEvaluationDataset(dataset, corpus)
  assert(Number.isInteger(topK) && topK > 0 && topK <= MAX_TOP_K, 'topK must be an integer between 1 and 100.')
  assert(VALID_SPLITS.has(split) || split === 'all', 'Unknown evaluation split.')
  const selectedCases = dataset.cases.filter(evaluationCase => split === 'all' || evaluationCase.split === split)
  assert(selectedCases.length > 0, 'Requested split has no evaluation cases.')
  assert(Array.isArray(results), 'Retrieval results must be an array.')
  const selectedIds = new Set(selectedCases.map(evaluationCase => evaluationCase.id))
  const resultsById = new Map()
  for (const result of results) {
    assert(isRecord(result) && selectedIds.has(result.caseId), 'Result must refer to a case in the requested split.')
    assert(!resultsById.has(result.caseId), 'Duplicate case results are invalid.')
    assert(Array.isArray(result.hits), 'Result hits must be an ordered array.')
    assert(typeof result.retrievalDurationMs === 'number' && Number.isFinite(result.retrievalDurationMs) &&
      result.retrievalDurationMs >= 0, 'Retrieval duration must be a finite nonnegative number.')
    for (const hit of result.hits) {
      assert(isRecord(hit) && corpus.has(hit.noteId), 'Retrieved hit must refer to a corpus note.')
      assert(isNonEmptyString(hit.text), 'Retrieved hit text must be nonempty.')
      assert(normalizeWhitespace(corpus.get(hit.noteId)).includes(normalizeWhitespace(hit.text)),
        'Retrieved hit must be an actual excerpt from its declared note.')
    }
    resultsById.set(result.caseId, result)
  }
  assert(resultsById.size === selectedCases.length, 'Every selected case must have a result, including empty results.')

  const cases = selectedCases.map(evaluationCase => {
    const result = resultsById.get(evaluationCase.id)
    const topHits = result.hits.slice(0, topK)
    const evidenceRanks = evaluationCase.evidence.map(evidence => {
      const index = topHits.findIndex(hit => hit.noteId === evidence.noteId &&
        normalizeWhitespace(hit.text).includes(normalizeWhitespace(evidence.quote)))
      return index === -1 ? null : index + 1
    })
    const foundRanks = evidenceRanks.filter(rank => rank !== null)
    return {
      caseId: evaluationCase.id,
      split: evaluationCase.split,
      answerable: evaluationCase.answerable,
      returnedHitCount: result.hits.length,
      recallAtK: evaluationCase.answerable ? foundRanks.length / evaluationCase.evidence.length : null,
      reciprocalRankAtK: foundRanks.length > 0 ? 1 / Math.min(...foundRanks) : evaluationCase.answerable ? 0 : null,
      allEvidenceFoundAtK: evaluationCase.answerable ? foundRanks.length === evaluationCase.evidence.length : null,
      noEvidenceEmptyResult: evaluationCase.answerable ? null : result.hits.length === 0,
      matchedEvidenceIds: evaluationCase.evidence.filter((_, index) => evidenceRanks[index] !== null)
        .map(evidence => evidence.id),
      missingEvidenceIds: evaluationCase.evidence.filter((_, index) => evidenceRanks[index] === null)
        .map(evidence => evidence.id),
      retrievalDurationMs: result.retrievalDurationMs
    }
  })
  const answerableCases = cases.filter(evaluationCase => evaluationCase.answerable)
  const unanswerableCases = cases.filter(evaluationCase => !evaluationCase.answerable)
  return {
    datasetVersion: dataset.version,
    split,
    topK,
    caseCount: cases.length,
    answerableCaseCount: answerableCases.length,
    unanswerableCaseCount: unanswerableCases.length,
    meanRecallAtK: mean(answerableCases.map(evaluationCase => evaluationCase.recallAtK)),
    meanReciprocalRankAtK: mean(answerableCases.map(evaluationCase => evaluationCase.reciprocalRankAtK)),
    completeEvidenceRateAtK: mean(answerableCases.map(evaluationCase => Number(evaluationCase.allEvidenceFoundAtK))),
    emptyResultRateOnUnanswerable: mean(unanswerableCases.map(evaluationCase => Number(evaluationCase.noEvidenceEmptyResult))),
    meanRetrievalDurationMs: mean(cases.map(evaluationCase => evaluationCase.retrievalDurationMs)),
    cases
  }
}

const main = async () => {
  const { values } = parseArgs({ options: {
    validate: { type: 'boolean', default: false },
    results: { type: 'string' },
    split: { type: 'string', default: 'development' },
    'top-k': { type: 'string', default: String(DEFAULT_TOP_K) }
  } })
  assert(!(values.validate && values.results), 'Choose validation or results evaluation.')
  const { dataset, corpus } = await loadEvaluationDataset()
  if (!values.results) {
    console.log(JSON.stringify({ status: 'validated', datasetVersion: dataset.version,
      noteCount: corpus.size, developmentCaseCount: dataset.cases.filter(item => item.split === 'development').length,
      heldoutCaseCount: dataset.cases.filter(item => item.split === 'heldout').length,
      retrievalImplemented: false, generationEvaluated: false }, null, 2))
    return
  }
  const results = JSON.parse(await readFile(values.results, 'utf8'))
  const report = evaluateRetrievalRun({ dataset, corpus, results, split: values.split, topK: Number(values['top-k']) })
  console.log(JSON.stringify(report, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`RAG evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    process.exitCode = 1
  })
}
