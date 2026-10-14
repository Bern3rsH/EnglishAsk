import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TextDecoder } from 'node:util'
import { splitNoteIntoChunks } from './rag-note-demo.mjs'
import { retrieveChunksWithPhraseBm25 } from './rag-phrase-bm25.mjs'

export const DIRECTORY_LIMITS = Object.freeze({
  maxEntries: 1000,
  maxNotes: 100,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
  maxChunks: 500
})
const DEFAULT_DIRECTORY = fileURLToPath(new URL('../tests/fixtures/rag/notes/', import.meta.url))
const DEFAULT_QUESTION = 'used to 和 be used to 的含义有什么区别？'
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
const hashContent = content => createHash('sha256').update(content).digest('hex')

async function readBoundedFile(path, maxBytes) {
  // O_NOFOLLOW 检查真正打开的文件，避免只检查目录列表中的旧状态。
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    assert(stat.isFile(), 'Note must be a regular file.')
    assert(stat.size <= maxBytes, 'Note exceeds the byte budget.')
    const buffer = Buffer.alloc(maxBytes + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
      if (bytesRead === 0) break
      length += bytesRead
    }
    assert(length <= maxBytes, 'Note exceeds the byte budget.')
    return buffer.subarray(0, length)
  } finally {
    await file.close()
  }
}

export async function loadDirectoryChunks(directoryPath, limits = DIRECTORY_LIMITS, options = {}) {
  const splitNote = options.splitNote ?? splitNoteIntoChunks
  assert(typeof splitNote === 'function', 'Note splitter must be a function.')
  options.signal?.throwIfAborted()
  assert(typeof directoryPath === 'string' && directoryPath.trim(), 'Directory path is required.')
  for (const name of Object.keys(DIRECTORY_LIMITS)) {
    assert(Number.isSafeInteger(limits[name]) && limits[name] > 0 && limits[name] <= DIRECTORY_LIMITS[name],
      `Invalid ${name} limit.`)
  }
  const directoryStat = await lstat(resolve(directoryPath))
  assert(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(), 'Expected a regular directory.')
  const directory = await realpath(directoryPath)
  const filenames = []
  let entryCount = 0
  for await (const entry of await opendir(directory)) {
    options.signal?.throwIfAborted()
    entryCount += 1
    assert(entryCount <= limits.maxEntries, 'Directory exceeds the entry limit.')
    if (!entry.name.toLowerCase().endsWith('.md')) continue
    assert(entry.isFile() && !entry.isSymbolicLink(), 'Markdown entries must be regular files.')
    filenames.push(entry.name)
    assert(filenames.length <= limits.maxNotes, 'Directory exceeds the note limit.')
  }
  filenames.sort()
  const chunks = []
  const notes = []
  let totalBytes = 0
  for (const filename of filenames) {
    options.signal?.throwIfAborted()
    const sourcePath = join(directory, filename)
    const remainingBytes = limits.maxTotalBytes - totalBytes
    assert(remainingBytes > 0, 'Directory exceeds the total byte budget.')
    const content = await readBoundedFile(sourcePath, Math.min(limits.maxFileBytes, remainingBytes))
    totalBytes += content.length
    const markdown = utf8Decoder.decode(content).replace(/\r\n?/g, '\n')
    options.signal?.throwIfAborted()
    const noteChunks = splitNote(markdown, filename)
    assert(Array.isArray(noteChunks) && noteChunks.every(chunk => chunk &&
      chunk.source === filename && typeof chunk.title === 'string' && typeof chunk.text === 'string'),
    'Note splitter returned invalid chunks.')
    assert(!markdown.trim() || noteChunks.length > 0,
      'Teaching splitter requires ## section headings in nonempty notes.')
    const sourceRevision = hashContent(content)
    notes.push({ source: filename, sourcePath, sourceRevision, markdown })
    for (const [sectionIndex, chunk] of noteChunks.entries()) {
      chunks.push({ ...chunk, sourcePath, sourceRevision, sectionIndex,
        sourceChunkId: hashContent(JSON.stringify([directory, filename, sourceRevision, sectionIndex])) })
      assert(chunks.length <= limits.maxChunks, 'Directory exceeds the chunk limit.')
    }
  }
  options.signal?.throwIfAborted()
  return { directory, noteCount: filenames.length, totalBytes, notes, chunks }
}

if (process.argv[1] && basename(process.argv[1]) === 'rag-directory-demo.mjs' &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const loaded = await loadDirectoryChunks(process.argv[2] ?? DEFAULT_DIRECTORY)
    const question = process.argv[3] ?? DEFAULT_QUESTION
    const retrieval = retrieveChunksWithPhraseBm25(loaded.chunks, question)
    // 默认只打印摘要；笔记正文和本地绝对路径不进入诊断输出。
    console.log(JSON.stringify({ question, noteCount: loaded.noteCount, chunkCount: loaded.chunks.length,
      totalBytes: loaded.totalBytes, queryTerms: retrieval.queryTerms,
      matches: retrieval.matches.map(chunk => ({ source: chunk.source, title: chunk.title,
        sourceRevision: chunk.sourceRevision, sourceChunkId: chunk.sourceChunkId, score: chunk.score })),
      generationCalled: false }, null, 2))
  } catch (error) {
    const message = error instanceof assert.AssertionError ? error.message
      : 'Could not read the Markdown directory (missing, unreadable, linked or invalid UTF-8 files).'
    console.error(message)
    process.exitCode = 1
  }
}
