import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NOTE_HEADING_PREFIX = '# '
const SECTION_HEADING_PREFIX = '## '
const SAMPLE_NOTES_DIRECTORY = new URL('../tests/fixtures/rag/notes/', import.meta.url)
const SAMPLE_NOTE_FILENAMES = ['used-to.md', 'be-used-to.md']
const DEFAULT_KEYWORD = '习惯'

const assertChunks = chunks => {
  assert(Array.isArray(chunks), 'Chunks must be an array.')
  assert(chunks.every(chunk => chunk !== null && typeof chunk === 'object' &&
    typeof chunk.source === 'string' && typeof chunk.title === 'string' &&
    typeof chunk.text === 'string'), 'Each chunk must have a string source, title and text.')
}

// 学习用切分器：处理一级主题、二级章节和章节正文。
// 二级标题之前的介绍文字不进入片段；这里不是完整的 Markdown 解析器。
export function splitNoteIntoChunks(markdown, filename) {
  assert(typeof markdown === 'string', 'Markdown must be a string.')
  assert(typeof filename === 'string' && filename.trim().length > 0,
    'Filename must be a non-empty string.')

  const chunks = []
  let currentChunk = null
  const lines = markdown.split('\n')
  let noteTitle = ''

  for (const line of lines) {
    if (line.startsWith(NOTE_HEADING_PREFIX)) {
      noteTitle = line.slice(NOTE_HEADING_PREFIX.length).trim()
      continue
    }
    if (line.startsWith(SECTION_HEADING_PREFIX)) {
      if (currentChunk) chunks.push(currentChunk)
      currentChunk = {
        source: filename,
        title: `${noteTitle} / ${line.slice(SECTION_HEADING_PREFIX.length).trim()}`,
        text: ''
      }
    } else if (currentChunk) {
      currentChunk.text += line + '\n'
    }
  }

  if (currentChunk) chunks.push(currentChunk)
  return chunks
}

export function findChunksByKeyword(chunks, keyword) {
  assertChunks(chunks)
  assert(typeof keyword === 'string', 'Keyword must be a string.')
  const normalizedKeyword = keyword.trim().toLowerCase()
  if (!normalizedKeyword) return []

  return chunks.filter(chunk => {
    const searchableText = `${chunk.title} ${chunk.text}`.toLowerCase()
    return searchableText.includes(normalizedKeyword)
  })
}

export function buildContext(chunks) {
  assertChunks(chunks)
  return chunks
    .map(chunk => `来源: ${chunk.source} \n 标题: ${chunk.title} \n ${chunk.text}`)
    .join('\n\n')
}

export async function loadSampleChunks() {
  const chunks = []
  for (const filename of SAMPLE_NOTE_FILENAMES) {
    const markdown = await readFile(new URL(filename, SAMPLE_NOTES_DIRECTORY), 'utf8')
    chunks.push(...splitNoteIntoChunks(markdown, filename))
  }
  return chunks
}

if (process.argv[1] && basename(process.argv[1]) === 'rag-note-demo.mjs' &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const keyword = process.argv[2] ?? DEFAULT_KEYWORD
    const chunks = await loadSampleChunks()
    const matchedChunks = findChunksByKeyword(chunks, keyword)
    const context = buildContext(matchedChunks)
    console.log(JSON.stringify({
      keyword,
      chunkCount: chunks.length,
      matchedChunks,
      context,
      message: matchedChunks.length === 0 ? '没有找到匹配的笔记片段' : '已生成检索上下文',
      generationCalled: false
    }, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Note retrieval experiment failed.')
    process.exitCode = 1
  }
}
