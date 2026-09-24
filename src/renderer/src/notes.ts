import type { NoteSummary } from '../../shared/ai'

export const MAX_GENERATED_NOTE_TITLE_CHARACTERS = 60
const DEFAULT_GENERATED_NOTE_TITLE = '未命名'

export const getGeneratedNoteTitle = (question: string): string => {
  const normalizedQuestion = question
    .replace(/[\\/\0]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  const truncatedQuestion = Array.from(normalizedQuestion)
    .slice(0, MAX_GENERATED_NOTE_TITLE_CHARACTERS)
    .join('')
    .trim()

  if (
    truncatedQuestion.length === 0 ||
    truncatedQuestion === '.' ||
    truncatedQuestion === '..'
  ) {
    return DEFAULT_GENERATED_NOTE_TITLE
  }

  return truncatedQuestion
}

export const sortNotesByFileName = (notes: NoteSummary[]): NoteSummary[] => {
  return [...notes].sort((leftNote, rightNote) => {
    const normalizedComparison = leftNote.title.localeCompare(rightNote.title, undefined, {
      numeric: true,
      sensitivity: 'base'
    })

    return normalizedComparison !== 0
      ? normalizedComparison
      : leftNote.title.localeCompare(rightNote.title)
  })
}

export const filterNotes = (notes: NoteSummary[], query: string): NoteSummary[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase()

  if (normalizedQuery.length === 0) {
    return notes
  }

  const tagQuery = normalizedQuery.replace(/^#/, '')
  return notes.filter((note) =>
    note.title.toLocaleLowerCase().includes(normalizedQuery) ||
    (note.tags ?? []).some((tag) => tag.toLocaleLowerCase().includes(tagQuery))
  )
}

export const upsertNoteSummary = (
  notes: NoteSummary[],
  nextNote: NoteSummary
): NoteSummary[] => {
  const remainingNotes = notes.filter((note) => note.id !== nextNote.id)
  return sortNotesByFileName([nextNote, ...remainingNotes])
}

export const replaceRenamedNoteSummary = (
  notes: NoteSummary[],
  previousNoteId: string,
  renamedNote: NoteSummary
): NoteSummary[] => {
  return upsertNoteSummary(
    notes.filter((note) => note.id !== previousNoteId),
    renamedNote
  )
}
