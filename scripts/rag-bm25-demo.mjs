import assert from 'node:assert/strict'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const IDF_SMOOTHING = 0.5
export const DEFAULT_K1 = 1.2
export const DEFAULT_B = 0.75

export const sampleTokenizedChunks = [
  { id: 'A', tokens: ['语法', '用法'] },
  { id: 'B', tokens: ['倒装句', '结构', '倒装句'] },
  { id: 'C', tokens: ['时态', '用法'] }
]

export function calculateIdf(totalChunks, documentFrequency) {
  assert(Number.isInteger(totalChunks) && totalChunks > 0, 'Total chunks must be a positive integer.')
  assert(Number.isInteger(documentFrequency) && documentFrequency >= 0 &&
    documentFrequency <= totalChunks, 'Document frequency must be between zero and total chunks.')
  return Math.log(1 + (totalChunks - documentFrequency + IDF_SMOOTHING) /
    (documentFrequency + IDF_SMOOTHING))
}

const assertParameters = (k1, b) => {
  assert(Number.isFinite(k1) && k1 >= 0, 'k1 must be finite and nonnegative.')
  assert(Number.isFinite(b) && b >= 0 && b <= 1, 'b must be between zero and one.')
}

// 先算一个查询词对一个片段的贡献，再将各查询词贡献相加。
export function calculateTermScore({
  idf, termFrequency, chunkLength, averageChunkLength, k1 = DEFAULT_K1, b = DEFAULT_B
}) {
  assertParameters(k1, b)
  assert(Number.isFinite(idf) && idf >= 0, 'IDF must be finite and nonnegative.')
  assert(Number.isInteger(chunkLength) && chunkLength >= 0, 'Chunk length must be nonnegative.')
  assert(Number.isInteger(termFrequency) && termFrequency >= 0 && termFrequency <= chunkLength,
    'Term frequency must be between zero and chunk length.')
  assert(Number.isFinite(averageChunkLength) && averageChunkLength > 0,
    'Average chunk length must be positive.')
  if (termFrequency === 0) return 0

  const lengthAdjustment = 1 - b + b * chunkLength / averageChunkLength
  const frequencyAdjustment = termFrequency * (k1 + 1) /
    (termFrequency + k1 * lengthAdjustment)
  return idf * frequencyAdjustment
}

const assertTokens = tokens => {
  assert(Array.isArray(tokens) && tokens.every(token =>
    typeof token === 'string' && token.trim().length > 0), 'Tokens must be non-empty strings in an array.')
}

export function rankTokenizedChunks(chunks, queryTokens, { k1 = DEFAULT_K1, b = DEFAULT_B } = {}) {
  assertParameters(k1, b)
  assert(Array.isArray(chunks), 'Chunks must be an array.')
  const ids = new Set()
  for (const chunk of chunks) {
    assert(chunk !== null && typeof chunk === 'object' &&
      typeof chunk.id === 'string' && chunk.id.trim().length > 0, 'Each chunk requires a non-empty ID.')
    assert(!ids.has(chunk.id), 'Chunk IDs must be unique.')
    ids.add(chunk.id)
    assertTokens(chunk.tokens)
  }
  assertTokens(queryTokens)
  if (chunks.length === 0 || queryTokens.length === 0) return []

  const queryTerms = [...new Set(queryTokens.map(token => token.trim().toLowerCase()))]
  const normalizedChunks = chunks.map(chunk => ({
    ...chunk, tokens: chunk.tokens.map(token => token.trim().toLowerCase())
  }))
  const averageChunkLength = normalizedChunks.reduce((total, chunk) => total + chunk.tokens.length, 0) /
    normalizedChunks.length
  if (averageChunkLength === 0) return []

  const documentFrequencies = new Map(queryTerms.map(term => [term,
    normalizedChunks.filter(chunk => chunk.tokens.includes(term)).length
  ]))

  return normalizedChunks.map(chunk => {
    const termScores = queryTerms.map(term => {
      const termFrequency = chunk.tokens.filter(token => token === term).length
      const documentFrequency = documentFrequencies.get(term)
      const idf = calculateIdf(normalizedChunks.length, documentFrequency)
      const contribution = calculateTermScore({
        idf, termFrequency, chunkLength: chunk.tokens.length, averageChunkLength, k1, b
      })
      return { term, documentFrequency, termFrequency, idf, contribution }
    }).filter(item => item.termFrequency > 0)

    return {
      ...chunk,
      chunkLength: chunk.tokens.length,
      averageChunkLength,
      matchedTermCount: termScores.length,
      termScores,
      score: termScores.reduce((total, item) => total + item.contribution, 0)
    }
  }).filter(chunk => chunk.score > 0)
    .sort((first, second) => second.score - first.score)
}

if (process.argv[1] && basename(process.argv[1]) === 'rag-bm25-demo.mjs' &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // 使用已经分好词的小样本，单独观察评分；这一步不读取用户笔记。
    const queryTokens = process.argv.length > 2 ? process.argv.slice(2) : ['倒装句', '用法']
    const matches = rankTokenizedChunks(sampleTokenizedChunks, queryTokens)
    console.log(JSON.stringify({ queryTokens, k1: DEFAULT_K1, b: DEFAULT_B, matches,
      generationCalled: false }, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'BM25 experiment failed.')
    process.exitCode = 1
  }
}
