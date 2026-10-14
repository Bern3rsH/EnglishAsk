import assert from 'node:assert/strict'
import { localEmbeddingRetriever } from './local-embedding'
import { fuseRetrievalRanks } from './hybrid-retrieval'
import type { RetrievalDiagnostic } from '../shared/embedding'
import { createHash } from 'node:crypto'
import { parser } from '@lezer/markdown'
import { loadDirectoryChunks, type DirectoryLimits } from '../../scripts/rag-directory-demo.mjs'
import { retrieveChunksWithPhraseBm25 } from '../../scripts/rag-phrase-bm25.mjs'
import { readNoteProvenance } from '../shared/note-provenance'
import { getConfiguredNoteStorageDirectory } from './settings'

const MAX_QUESTION_CHARACTERS = 2000
const DEFAULT_TOP_K = 3
const MAX_TOP_K = 100
const DOCUMENT_SECTION_TITLE = '全文'
const hashContent = (text: string): string => createHash('sha256').update(text).digest('hex')
const headingLevels: Record<string, number> = {
  ATXHeading1: 1, ATXHeading2: 2, SetextHeading1: 1, SetextHeading2: 2
}

// 与教学切分器分开：保留介绍文字、无章节正文，且不把代码块中的 ## 当作标题。
export const splitApplicationNote = (markdown: string, filename: string) => {
  readNoteProvenance(markdown)
  const frontmatter = markdown.match(/^\uFEFF?---\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/m)
  const body = frontmatter?.index === 0 ? markdown.slice(frontmatter[0].length) : markdown
  const tree = parser.parse(body)
  const chunks: { source: string; title: string; text: string }[] = []
  let topic = filename.replace(/\.md$/i, '')
  let section = DOCUMENT_SECTION_TITLE
  let bodyStart = 0
  const appendChunk = (bodyEnd: number) => {
    const text = body.slice(bodyStart, bodyEnd).trim()
    if (text) chunks.push({ source: filename, title: `${topic} / ${section}`, text })
  }
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    const level = headingLevels[node.name]
    if (!level) continue
    appendChunk(node.from)
    const headingText = body.slice(node.from, node.to)
    const heading = (node.name.startsWith('Setext')
      ? headingText.split('\n').slice(0, -1).join(' ')
      : headingText.replace(/^#{1,2}\s+/, '').replace(/[ \t]+#+[ \t]*$/, '')).trim()
    if (level === 1) {
      topic = heading
      section = DOCUMENT_SECTION_TITLE
    } else {
      section = heading
    }
    bodyStart = node.to
  }
  appendChunk(body.length)
  // 标题本身也是笔记内容；只有标题时仍提供一个可检索片段。
  if (!chunks.length && body.trim()) {
    chunks.push({ source: filename, title: `${topic} / ${section}`, text: body.trim() })
  }
  return chunks
}

export const retrieveNotes = async (question: string, options: {
  notesDirectory?: string
  topK?: number
  limits?: DirectoryLimits
  signal?: AbortSignal
  lexicalOnly?: boolean
} = {}) => {
  assert(typeof question === 'string' && question.trim() && question.length <= MAX_QUESTION_CHARACTERS,
    `Notes question must contain 1–${MAX_QUESTION_CHARACTERS} characters.`)
  const topK = options.topK ?? DEFAULT_TOP_K
  assert(Number.isInteger(topK) && topK > 0 && topK <= MAX_TOP_K, 'Invalid Notes top-k.')
  options.signal?.throwIfAborted()
  const directory = options.notesDirectory ?? await getConfiguredNoteStorageDirectory()
  const loaded = await loadDirectoryChunks(directory, options.limits, {
    signal: options.signal, splitNote: splitApplicationNote
  })
  const directoryScopeId = hashContent(loaded.directory)
  const identities = new Map<string, { noteIdentity: string; identityKind: 'persisted' | 'filename' }>()
  const seenNoteIdentities = new Set<string>()
  for (const note of loaded.notes) {
    const metadata = readNoteProvenance(note.markdown)
    const noteIdentity = metadata ? `uuid:${metadata.note_id.toLowerCase()}` : `filename:${note.source}`
    assert(!seenNoteIdentities.has(noteIdentity), 'Multiple Notes share the same persisted identity.')
    seenNoteIdentities.add(noteIdentity)
    identities.set(note.source, { noteIdentity, identityKind: metadata ? 'persisted' : 'filename' })
  }
  const chunks = loaded.chunks.map(chunk => {
    const identity = identities.get(chunk.source)
    assert(identity, 'Chunk source is missing from the loaded Notes.')
    return { ...chunk, ...identity, noteId: chunk.source, directoryScopeId,
      sourceChunkId: hashContent(JSON.stringify([
        directoryScopeId, identity.noteIdentity, chunk.sourceRevision, chunk.sectionIndex
      ])) }
  })
  options.signal?.throwIfAborted()
  const retrieval = retrieveChunksWithPhraseBm25(chunks, question, MAX_TOP_K)
  let retrievalDiagnostic: RetrievalDiagnostic = { mode: 'bm25' }
  let matches = retrieval.matches.slice(0, topK)
  if (!options.lexicalOnly) {
    try {
      const semantic = await localEmbeddingRetriever.rank(chunks, question, options.signal, directoryScopeId)
      if (semantic && chunks.length) {
        matches = fuseRetrievalRanks(chunks, retrieval.matches, semantic, topK)
        retrievalDiagnostic = { mode: 'hybrid' }
      }
    } catch {
      options.signal?.throwIfAborted()
      retrievalDiagnostic.notice = '本地语义检索不可用，本次已使用关键词检索。请在 Notes 设置中检查模型或稍后重试。'
    }
  }
  options.signal?.throwIfAborted()
  return { directory: loaded.directory, directoryScopeId, noteCount: loaded.noteCount,
    chunkCount: chunks.length, totalBytes: loaded.totalBytes, ...retrieval, matches, context: matches.map(chunk => `来源: ${chunk.source}\n标题: ${chunk.title}\n${chunk.text}`).join('\n\n'), retrievalDiagnostic }
}
