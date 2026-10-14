import assert from 'node:assert/strict'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildContext, loadSampleChunks } from './rag-note-demo.mjs'

const DEFAULT_QUESTION = '我的笔记中有关习惯的笔记有哪些？'
// 仅用于当前 Notes 搜索实验的问法词，不是通用中文停用词表。
const QUERY_STOP_WORDS = new Set(['我的', '我', '笔记', '中', '有关', '关于', '的', '有', '哪些', '请'])
// “可以”也可能是学习目标或许可含义，仅在明确的表达查询问法中忽略。
const EXPRESSION_REQUEST_PATTERN = /可以\s*用\s*(?:什么|哪些)\s*(?:表达|说法)/u
const NEGATED_PERMISSION_PATTERN = /不\s*可以/u
assert(typeof Intl.Segmenter === 'function', 'This experiment requires Intl.Segmenter support.')
const wordSegmenter = new Intl.Segmenter('zh', { granularity: 'word' })

export function extractQueryKeywords(question) {
  assert(typeof question === 'string', 'Question must be a string.')
  const keywords = []
  const ignoreRequestCan = EXPRESSION_REQUEST_PATTERN.test(question) && !NEGATED_PERMISSION_PATTERN.test(question)

  for (const item of wordSegmenter.segment(question.toLowerCase())) {
    if (!item.isWordLike) continue
    if (QUERY_STOP_WORDS.has(item.segment)) continue
    if (ignoreRequestCan && item.segment === '可以') continue
    if (!keywords.includes(item.segment)) keywords.push(item.segment)
  }

  return keywords
}

export function rankChunksByQuestion(chunks, question) {
  assert(Array.isArray(chunks), 'Chunks must be an array.')
  assert(chunks.every(chunk => chunk !== null && typeof chunk === 'object' &&
    typeof chunk.source === 'string' && typeof chunk.title === 'string' &&
    typeof chunk.text === 'string'), 'Each chunk must have a string source, title and text.')
  const keywords = extractQueryKeywords(question)

  return chunks
    .map(chunk => {
      const searchableText = `${chunk.title} ${chunk.text}`.toLowerCase()
      const matchedKeywords = keywords.filter(keyword => searchableText.includes(keyword))
      return { ...chunk, matchedKeywords, score: matchedKeywords.length }
    })
    .filter(chunk => chunk.score > 0)
    .sort((first, second) => second.score - first.score)
}

if (process.argv[1] && basename(process.argv[1]) === 'rag-query-demo.mjs' &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const question = process.argv[2] ?? DEFAULT_QUESTION
    const chunks = await loadSampleChunks()
    const keywords = extractQueryKeywords(question)
    const matches = rankChunksByQuestion(chunks, question)
    console.log(JSON.stringify({
      question,
      keywords,
      matches,
      context: buildContext(matches),
      message: matches.length === 0 ? '没有找到匹配的笔记片段' : '已生成检索上下文',
      generationCalled: false
    }, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Query retrieval experiment failed.')
    process.exitCode = 1
  }
}
