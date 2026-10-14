import assert from 'node:assert/strict'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rankTokenizedChunks } from './rag-bm25-demo.mjs'
import { buildContext, loadSampleChunks } from './rag-note-demo.mjs'
import { extractQueryKeywords } from './rag-query-demo.mjs'

export const DEFAULT_TOP_K = 3
const MAX_TOP_K = 100
const DEFAULT_QUESTION = '我的笔记中有关习惯的笔记有哪些？'
const wordSegmenter = new Intl.Segmenter('zh', { granularity: 'word' })

// 保留正文中的重复词，供 BM25 统计 TF 和片段长度。
// 与问题使用同样的分词方式；这里只过滤标点，不对正文做关键词去重。
export function tokenizeChunkText(text) {
  assert(typeof text === 'string', 'Chunk text must be a string.')
  const tokens = []
  for (const item of wordSegmenter.segment(text.toLowerCase())) {
    if (item.isWordLike) tokens.push(item.segment)
  }
  return tokens
}

export function retrieveChunksWithBm25(chunks, question, topK = DEFAULT_TOP_K) {
  assert(Number.isInteger(topK) && topK > 0 && topK <= MAX_TOP_K,
    `top-k must be an integer between 1 and ${MAX_TOP_K}.`)
  assert(Array.isArray(chunks), 'Chunks must be an array.')
  assert(chunks.every(chunk => chunk !== null && typeof chunk === 'object' &&
    typeof chunk.source === 'string' && typeof chunk.title === 'string' &&
    typeof chunk.text === 'string'), 'Each chunk must have a string source, title and text.')

  const queryTerms = extractQueryKeywords(question)
  const tokenizedChunks = chunks.map((chunk, index) => ({
    ...chunk,
    // 仅用于当前实验的一次运行，不作为持久化的笔记身份。
    id: `chunk-${index + 1}`,
    tokens: tokenizeChunkText(`${chunk.title}\n${chunk.text}`)
  }))
  const rankedChunks = rankTokenizedChunks(tokenizedChunks, queryTerms)
  const matches = rankedChunks.slice(0, topK)

  return {
    queryTerms,
    candidateCount: rankedChunks.length,
    matches,
    context: buildContext(matches)
  }
}

if (process.argv[1] && basename(process.argv[1]) === 'rag-note-bm25.mjs' &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const question = process.argv[2] ?? DEFAULT_QUESTION
    const topK = process.argv[3] === undefined ? DEFAULT_TOP_K : Number(process.argv[3])
    const chunks = await loadSampleChunks()
    const result = retrieveChunksWithBm25(chunks, question, topK)
    console.log(JSON.stringify({
      question,
      topK,
      chunkCount: chunks.length,
      ...result,
      message: result.matches.length === 0 ? '没有找到匹配的笔记片段' : '已生成 BM25 检索上下文',
      generationCalled: false
    }, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Markdown BM25 experiment failed.')
    process.exitCode = 1
  }
}
