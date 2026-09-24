import type {
  NoteDocument,
  NoteDocumentResult,
  NotesListResult,
  NoteSummary
} from '../../shared/ai'
import { sortNotesByFileName } from './notes'

export const NOTES_SYNC_INTERVAL_MS = 2_000

export interface NotesSyncSnapshot {
  activeNoteId: string | null
  markdown: string
  notes: NoteSummary[]
  isDirty: boolean
  isBusy: boolean
  revision: number
}

interface NotesSyncDependencies {
  getSnapshot: () => NotesSyncSnapshot
  listNotes: () => Promise<NotesListResult>
  getNote: (noteId: string) => Promise<NoteDocumentResult>
  onNotes: (notes: NoteSummary[]) => void
  onDocument: (note: NoteDocument) => void
  onEmpty: () => void
  onError: (message: string | null) => void
}

const haveSameNotes = (left: NoteSummary[], right: NoteSummary[]): boolean =>
  left.length === right.length &&
  left.every((note, index) => {
    const other = right[index]
    return (
      note.id === other.id &&
      note.title === other.title &&
      note.createdAt === other.createdAt &&
      note.updatedAt === other.updatedAt &&
      JSON.stringify(note.tags ?? []) === JSON.stringify(other.tags ?? [])
    )
  })

export const createNotesSynchronizer = (dependencies: NotesSyncDependencies) => {
  let isDisposed = false
  let isRefreshing = false

  const isCurrent = (snapshot: NotesSyncSnapshot): boolean => {
    const current = dependencies.getSnapshot()
    return (
      !isDisposed &&
      !current.isBusy &&
      current.revision === snapshot.revision &&
      current.activeNoteId === snapshot.activeNoteId &&
      current.markdown === snapshot.markdown &&
      current.isDirty === snapshot.isDirty
    )
  }

  const applyNotes = (notes: NoteSummary[], snapshot: NotesSyncSnapshot): void => {
    if (!haveSameNotes(snapshot.notes, notes)) {
      dependencies.onNotes(notes)
    }
  }

  return {
    dispose: (): void => {
      isDisposed = true
    },
    refresh: async (): Promise<void> => {
      const snapshot = { ...dependencies.getSnapshot() }

      if (isDisposed || isRefreshing || snapshot.isBusy) {
        return
      }

      isRefreshing = true

      try {
        const result = await dependencies.listNotes()

        if (!isCurrent(snapshot)) {
          return
        }

        if (!result.ok) {
          throw new Error(result.error)
        }

        const notes = sortNotesByFileName(result.data)
        const activeNoteExists = notes.some((note) => note.id === snapshot.activeNoteId)

        if (snapshot.isDirty) {
          // A deleted file may still have an unsaved editor draft. Keep it reachable.
          const unsavedNote = snapshot.notes.find((note) => note.id === snapshot.activeNoteId)
          if (!activeNoteExists && unsavedNote) {
            applyNotes(sortNotesByFileName([...notes, unsavedNote]), snapshot)
            dependencies.onError(
              'This Note was deleted outside the app. Unsaved edits are kept in the editor; restore the file before saving.'
            )
          } else {
            applyNotes(notes, snapshot)
            dependencies.onError(null)
          }
          return
        }

        const nextNoteId = activeNoteExists ? snapshot.activeNoteId : notes[0]?.id

        if (!nextNoteId) {
          applyNotes(notes, snapshot)
          if (snapshot.activeNoteId !== null) {
            dependencies.onEmpty()
          }
          dependencies.onError(null)
          return
        }

        const noteResult = await dependencies.getNote(nextNoteId)

        if (!isCurrent(snapshot)) {
          return
        }

        if (!noteResult.ok) {
          throw new Error(noteResult.error)
        }

        applyNotes(notes, snapshot)
        if (
          snapshot.activeNoteId !== noteResult.data.id ||
          snapshot.markdown !== noteResult.data.markdown
        ) {
          dependencies.onDocument(noteResult.data)
        }
        dependencies.onError(null)
      } catch (error) {
        if (isCurrent(snapshot)) {
          dependencies.onError(error instanceof Error ? error.message : 'Unable to sync Notes.')
        }
      } finally {
        isRefreshing = false
      }
    }
  }
}
