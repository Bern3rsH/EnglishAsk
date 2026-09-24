import { shell } from 'electron'
import type { DeleteNoteResponse } from '../shared/ai'
import { listNotes, trashNote } from './note-storage'

interface NoteTrashDependencies {
  notesDirectory?: string
  trashItem?: (notePath: string) => Promise<void>
}

export const moveNoteToSystemTrash = async (
  noteIdValue: unknown,
  dependencies: NoteTrashDependencies = {}
): Promise<DeleteNoteResponse> => {
  const notes = await listNotes(dependencies.notesDirectory)
  const note =
    typeof noteIdValue === 'string'
      ? notes.find((candidateNote) => candidateNote.id === noteIdValue)
      : undefined

  if (!note) {
    throw new Error('Note was not found.')
  }

  return trashNote(
    note.id,
    dependencies.trashItem ??
      (async (notePath) => {
        await shell.trashItem(notePath)
      }),
    dependencies.notesDirectory
  )
}
