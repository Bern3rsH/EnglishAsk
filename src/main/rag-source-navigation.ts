import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isNoteAnswerSource } from '../shared/rag'
import { readNoteProvenance } from '../shared/note-provenance'
import { loadDirectoryChunks } from '../../scripts/rag-directory-demo.mjs'
import { splitApplicationNote } from './rag-note-retrieval'
import { getNote } from './note-storage'
import { getConfiguredNoteStorageDirectory } from './settings'

const hashContent = (text: string) => createHash('sha256').update(text).digest('hex')

export const openNoteAnswerSource = async (input: unknown) => {
  if (!isNoteAnswerSource(input)) throw new Error('笔记来源信息无效，请重新提问。')
  const directory = await realpath(await getConfiguredNoteStorageDirectory())
  if (hashContent(directory) !== input.directoryScopeId) throw new Error('Notes 目录已变更，请切回原目录或重新提问。')
  const loaded = await loadDirectoryChunks(directory, undefined, { splitNote: splitApplicationNote })
  const matchingNotes = loaded.notes.filter(note => input.identityKind === 'filename'
    ? note.source === input.noteId
    : `uuid:${readNoteProvenance(note.markdown)?.note_id.toLowerCase()}` === input.noteIdentity)
  if (matchingNotes.length !== 1) throw new Error('原笔记已删除或身份冲突，请重新提问。')
  const note = matchingNotes[0]
  if (note.sourceRevision !== input.sourceRevision) throw new Error('笔记内容已更新，请重新提问以获取最新来源。')
  const chunk = loaded.chunks.find(item => item.source === note.source && item.sectionIndex === input.sectionIndex)
  const expectedChunkId = hashContent(JSON.stringify([
    input.directoryScopeId, input.noteIdentity, input.sourceRevision, input.sectionIndex
  ]))
  if (!chunk || input.sourceChunkId !== expectedChunkId || input.text !== chunk.text || input.title !== chunk.title) {
    throw new Error('来源片段与原笔记不一致，请重新提问。')
  }
  const document = await getNote(note.source, directory)
  if (hashContent(document.markdown) !== input.sourceRevision) {
    throw new Error('笔记内容已更新，请重新提问以获取最新来源。')
  }
  return document
}
