import { describe, expect, it } from 'vitest'
import type { NoteSummary } from '../../shared/ai'
import {
  filterNotes,
  getGeneratedNoteTitle,
  MAX_GENERATED_NOTE_TITLE_CHARACTERS,
  replaceRenamedNoteSummary,
  sortNotesByFileName,
  upsertNoteSummary
} from './notes'

const createNoteSummary = (
  id: string,
  title: string,
  updatedAt: string
): NoteSummary => ({
  id,
  title,
  createdAt: '2026-07-26T10:00:00.000Z',
  updatedAt
})

describe('notes helpers', () => {
  it('matches titles and tags with or without a hash, ignoring case', () => {
    const tagged = { ...createNoteSummary('a.md', 'Example', '1'), tags: ['短语', 'Usage'] }
    const plain = createNoteSummary('b.md', 'Other', '1')
    for (const query of ['短语', '#短语', 'usage', '#USAGE', '解释', 'example']) {
      expect(filterNotes([tagged, plain], query)).toEqual(query === '解释' ? [] : [tagged])
    }
    expect(filterNotes([tagged, plain], '#')).toEqual([tagged])
  })
  it('uses a normalized source question as the generated Note title', () => {
    expect(getGeneratedNoteTitle('  What is the difference between say / tell?  ')).toBe(
      'What is the difference between say - tell?'
    )
  })

  it('keeps generated Note titles within a safe Unicode character limit', () => {
    const longQuestion = '词'.repeat(MAX_GENERATED_NOTE_TITLE_CHARACTERS + 10)

    expect(Array.from(getGeneratedNoteTitle(longQuestion))).toHaveLength(
      MAX_GENERATED_NOTE_TITLE_CHARACTERS
    )
    expect(getGeneratedNoteTitle(' / ')).toBe('-')
    expect(getGeneratedNoteTitle('..')).toBe('未命名')
  })

  it('sorts notes naturally by filename', () => {
    const noteTen = createNoteSummary('note-10', 'Note 10', '2026-07-26T10:00:00.000Z')
    const noteTwo = createNoteSummary('note-2', 'Note 2', '2026-07-26T11:00:00.000Z')

    expect(sortNotesByFileName([noteTen, noteTwo])).toEqual([noteTwo, noteTen])
  })

  it('filters note titles case-insensitively', () => {
    const grammarNote = createNoteSummary('grammar', 'Grammar Patterns', '2026-07-26T10:00:00.000Z')
    const wordsNote = createNoteSummary('words', 'New Words', '2026-07-26T11:00:00.000Z')

    expect(filterNotes([grammarNote, wordsNote], 'grammar')).toEqual([grammarNote])
  })

  it('replaces an existing summary and keeps filename order', () => {
    const firstNote = createNoteSummary('first', 'First', '2026-07-26T10:00:00.000Z')
    const secondNote = createNoteSummary('second', 'Second', '2026-07-26T11:00:00.000Z')
    const updatedFirstNote = createNoteSummary('first', 'A First', '2026-07-26T12:00:00.000Z')

    expect(upsertNoteSummary([secondNote, firstNote], updatedFirstNote)).toEqual([
      updatedFirstNote,
      secondNote
    ])
  })

  it('removes the previous ID after a file rename', () => {
    const originalNote = createNoteSummary('Original.md', 'Original', '2026-07-26T10:00:00.000Z')
    const otherNote = createNoteSummary('Other.md', 'Other', '2026-07-26T11:00:00.000Z')
    const renamedNote = createNoteSummary('Renamed.md', 'Renamed', '2026-07-26T12:00:00.000Z')

    expect(replaceRenamedNoteSummary([originalNote, otherNote], originalNote.id, renamedNote)).toEqual([
      otherNote,
      renamedNote
    ])
  })
})
