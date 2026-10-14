import assert from 'node:assert/strict'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rankTokenizedChunks } from './rag-bm25-demo.mjs'
import { buildContext, loadSampleChunks } from './rag-note-demo.mjs'
import { DEFAULT_TOP_K, tokenizeChunkText } from './rag-note-bm25.mjs'
import { extractQueryKeywords } from './rag-query-demo.mjs'

const TOPIC_SEPARATOR = ' / '
const MAX_TOP_K = 100
const ENGLISH_WORD_CHARACTER = /[a-z0-9_]/
const DEFAULT_QUESTION = 'used to 和 be used to 的含义有什么区别？'

function normalizeText(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function validateChunks(chunks) {
  assert(Array.isArray(chunks), 'Chunks must be an array.')
  assert(chunks.every(chunk => chunk !== null && typeof chunk === 'object' &&
    typeof chunk.source === 'string' && typeof chunk.title === 'string' &&
    typeof chunk.text === 'string'), 'Each chunk must have a string source, title and text.')
}

// 教学 splitter 的标题格式为“笔记主题 / 小标题”；生产实现应使用独立主题字段。
export function collectNoteTopics(chunks) {
  validateChunks(chunks)
  return [...new Set(chunks.map(chunk => normalizeText(
    chunk.title.split(TOPIC_SEPARATOR)[0]
  )).filter(Boolean))]
}

function tokenizePreservingTopics(text, topics, tokenizeRemainder) {
  assert(typeof text === 'string', 'Text must be a string.')
  assert(Array.isArray(topics) && topics.every(topic => typeof topic === 'string' && topic.trim()),
    'Topics must be an array of nonempty strings.')
  const normalizedText = normalizeText(text)
  const orderedTopics = [...new Set(topics.map(normalizeText))]
    .sort((first, second) => second.length - first.length)
  const tokens = []
  let remainderStart = 0
  let cursor = 0

  while (cursor < normalizedText.length) {
    const matchedTopic = orderedTopics.find(topic => {
      if (!normalizedText.startsWith(topic, cursor)) return false
      const before = normalizedText[cursor - 1] ?? ''
      const after = normalizedText[cursor + topic.length] ?? ''
      // 避免把 unused to 或 used today 当成 used to。
      return !(ENGLISH_WORD_CHARACTER.test(topic[0]) && ENGLISH_WORD_CHARACTER.test(before)) &&
        !(ENGLISH_WORD_CHARACTER.test(topic.at(-1)) && ENGLISH_WORD_CHARACTER.test(after))
    })
    if (!matchedTopic) {
      cursor += 1
      continue
    }
    tokens.push(...tokenizeRemainder(normalizedText.slice(remainderStart, cursor)), matchedTopic)
    cursor += matchedTopic.length
    remainderStart = cursor
  }
  tokens.push(...tokenizeRemainder(normalizedText.slice(remainderStart)))
  return tokens
}

export function tokenizeChunkWithTopics(text, topics) {
  // 正文保留重复表达，继续供 BM25 统计 TF。
  return tokenizePreservingTopics(text, topics, tokenizeChunkText)
}

export function extractQueryTermsWithTopics(question, topics) {
  return [...new Set(tokenizePreservingTopics(question, topics, extractQueryKeywords))]
}

export function retrieveChunksWithPhraseBm25(chunks, question, topK = DEFAULT_TOP_K) {
  validateChunks(chunks)
  assert(Number.isInteger(topK) && topK > 0 && topK <= MAX_TOP_K,
    `top-k must be an integer between 1 and ${MAX_TOP_K}.`)
  const topics = collectNoteTopics(chunks)
  const queryTerms = extractQueryTermsWithTopics(question, topics)
  const tokenizedChunks = chunks.map((chunk, index) => ({
    ...chunk,
    id: `chunk-${index + 1}`,
    tokens: tokenizeChunkWithTopics(`${chunk.title}\n${chunk.text}`, topics)
  }))
  const rankedChunks = rankTokenizedChunks(tokenizedChunks, queryTerms)
  const matches = rankedChunks.slice(0, topK)
  return { topics, queryTerms, candidateCount: rankedChunks.length, matches, context: buildContext(matches) }
}

if (process.argv[1] && basename(process.argv[1]) === 'rag-phrase-bm25.mjs' &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const question = process.argv[2] ?? DEFAULT_QUESTION
    const topK = process.argv[3] === undefined ? DEFAULT_TOP_K : Number(process.argv[3])
    const chunks = await loadSampleChunks()
    console.log(JSON.stringify({ question, topK, ...retrieveChunksWithPhraseBm25(chunks, question, topK),
      generationCalled: false }, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Phrase BM25 experiment failed.')
    process.exitCode = 1
  }
}
