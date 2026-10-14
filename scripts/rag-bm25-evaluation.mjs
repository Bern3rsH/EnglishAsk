import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  DEFAULT_TOP_K, MAX_TOP_K, evaluateRetrievalRun, loadEvaluationDataset,
  validateEvaluationDataset
} from './rag-evaluation.mjs'
import { splitNoteIntoChunks } from './rag-note-demo.mjs'
import { retrieveChunksWithBm25 } from './rag-note-bm25.mjs'

export function evaluateBm25Dataset({ dataset, corpus, split = 'development', topK = DEFAULT_TOP_K }) {
  validateEvaluationDataset(dataset, corpus)
  assert(['development', 'heldout', 'all'].includes(split), 'Unknown evaluation split.')
  assert(Number.isInteger(topK) && topK > 0 && topK <= MAX_TOP_K,
    `top-k must be an integer between 1 and ${MAX_TOP_K}.`)
  const selectedCases = dataset.cases.filter(item => split === 'all' || item.split === split)
  assert(selectedCases.length > 0, 'Requested split has no evaluation cases.')

  const chunks = []
  for (const noteId of dataset.notes) {
    chunks.push(...splitNoteIntoChunks(corpus.get(noteId), noteId))
  }

  const results = []
  const diagnostics = []
  for (const evaluationCase of selectedCases) {
    const start = performance.now()
    // 检索只接收问题和片段；不使用期望证据或 answerable 标注。
    const retrieval = retrieveChunksWithBm25(chunks, evaluationCase.query, topK)
    const retrievalDurationMs = performance.now() - start
    results.push({
      caseId: evaluationCase.id,
      hits: retrieval.matches.map(chunk => ({ noteId: chunk.source, text: chunk.text })),
      retrievalDurationMs
    })
    diagnostics.push({
      caseId: evaluationCase.id,
      queryTerms: retrieval.queryTerms,
      candidateCount: retrieval.candidateCount,
      selectedChunks: retrieval.matches.map(chunk => ({
        noteId: chunk.source,
        title: chunk.title,
        score: chunk.score,
        matchedTerms: chunk.termScores.map(item => item.term)
      }))
    })
  }

  return {
    method: 'bm25',
    chunkCount: chunks.length,
    generationEvaluated: false,
    timingScope: 'In-process retrieval, including tokenization; excludes file loading and model requests.',
    results,
    report: evaluateRetrievalRun({ dataset, corpus, results, topK, split }),
    diagnostics
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      split: { type: 'string', default: 'development' },
      'top-k': { type: 'string', default: String(DEFAULT_TOP_K) }
    } })
    const { dataset, corpus } = await loadEvaluationDataset()
    const { results, ...output } = evaluateBm25Dataset({
      dataset, corpus, split: values.split, topK: Number(values['top-k'])
    })
    // CLI 展示排名与评分报告，不打印完整笔记正文。
    console.log(JSON.stringify(output, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'BM25 evaluation failed.')
    process.exitCode = 1
  }
}
