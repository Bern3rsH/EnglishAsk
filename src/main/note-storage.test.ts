import { mkdir, mkdtemp, readFile, rename as renameFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readNoteProvenance, withoutNoteProvenance } from '../shared/note-provenance'
import {
  createNote,
  getNote,
  listNotes,
  renameNote,
  saveNote,
  trashNote
} from './note-storage'

describe('note storage', () => {
  it('indexes tags from unopened files and refreshes them after external edits and saves', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'english-ask-tags-'))
    const path = join(directory, 'Example.md')
    await writeFile(path, '#短语\n正文')
    expect((await listNotes(directory))[0].tags).toEqual(['短语'])
    await writeFile(path, '#解释含义 #Usage\n新正文')
    expect((await listNotes(directory))[0].tags).toEqual(['解释含义', 'Usage'])
    const saved = await saveNote({ id: 'Example.md', markdown: '#新标签' }, directory)
    expect(saved.tags).toEqual(['新标签'])
    expect((await listNotes(directory))[0].tags).toEqual(['新标签'])
  })
  it('creates, saves, reads, and lists Markdown notes in the selected directory', async () => {
    const notesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-notes-'))
    const createdNote = await createNote(notesDirectory)
    const savedNote = await saveNote(
      {
        id: createdNote.id,
        markdown: '# Local note\n\nStored as Markdown.'
      },
      notesDirectory
    )

    expect(savedNote.title).toBe('未命名')
    await expect(getNote(createdNote.id, notesDirectory)).resolves.toMatchObject({
      id: createdNote.id,
      title: '未命名',
      markdown: savedNote.markdown
    })
    await expect(listNotes(notesDirectory)).resolves.toEqual([
      expect.objectContaining({
        id: createdNote.id,
        title: '未命名'
      })
    ])
    await expect(
      readFile(join(notesDirectory, createdNote.id), 'utf8')
    ).resolves.toBe(savedNote.markdown)
    expect(withoutNoteProvenance(savedNote.markdown)).toBe('# Local note\n\nStored as Markdown.')
    expect(readNoteProvenance(savedNote.markdown)?.note_id).toBe(readNoteProvenance(createdNote.markdown)?.note_id)
  })

  it('creates question-titled notes with initial Markdown and unique suffixes', async () => {
    const notesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-notes-'))
    const initialMarkdown = '# Generated answer\n\nSaved from an Ask.'
    const question = 'What does cold turkey mean?'
    const createdNote = await createNote(notesDirectory, initialMarkdown, question)
    const duplicateNote = await createNote(notesDirectory, initialMarkdown, question)

    expect(createdNote).toMatchObject({
      id: `${question}.md`,
      title: question,
      markdown: createdNote.markdown
    })
    expect(duplicateNote).toMatchObject({
      id: `${question} 1.md`,
      title: `${question} 1`
    })
    await expect(readFile(join(notesDirectory, createdNote.id), 'utf8')).resolves.toBe(
      createdNote.markdown
    )
    expect(withoutNoteProvenance(createdNote.markdown)).toBe(initialMarkdown)
    expect(readNoteProvenance(createdNote.markdown)?.note_id).not.toBe(readNoteProvenance(duplicateNote.markdown)?.note_id)
  })

  it('rejects invalid initial Markdown before creating a note file', async () => {
    const notesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-notes-'))

    await expect(createNote(notesDirectory, null)).rejects.toThrow(
      'Note Markdown must be a string.'
    )
    await expect(listNotes(notesDirectory)).resolves.toEqual([])
  })

  it('lists and edits existing Markdown files with regular file names', async () => {
    const notesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-notes-'))

    await writeFile(join(notesDirectory, 'learning plan.md'), '# Learning plan\n\nOriginal.', 'utf8')
    await writeFile(join(notesDirectory, 'asset.png'), 'not-an-image', 'utf8')

    await expect(listNotes(notesDirectory)).resolves.toEqual([
      expect.objectContaining({
        id: 'learning plan.md',
        title: 'learning plan'
      })
    ])

    await expect(getNote('learning plan.md', notesDirectory)).resolves.toMatchObject({
      id: 'learning plan.md',
      markdown: '# Learning plan\n\nOriginal.'
    })

    await saveNote(
      {
        id: 'learning plan.md',
        markdown: '# Learning plan\n\nEdited in Notes.'
      },
      notesDirectory
    )

    expect(withoutNoteProvenance(await readFile(join(notesDirectory, 'learning plan.md'), 'utf8'))).toBe(
      '# Learning plan\n\nEdited in Notes.'
    )
  })

  it('uses an empty existing Markdown file name as its list title', async () => {
    const notesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-notes-'))

    await writeFile(join(notesDirectory, 'Vocabulary.MD'), '', 'utf8')

    await expect(listNotes(notesDirectory)).resolves.toEqual([
      expect.objectContaining({
        id: 'Vocabulary.MD',
        title: 'Vocabulary'
      })
    ])
  })

  it('increments Obsidian-style 未命名 names without overwriting existing notes', async () => {
    const notesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-notes-'))

    await writeFile(join(notesDirectory, '未命名.md'), '# Existing', 'utf8')
    await writeFile(join(notesDirectory, '未命名 1.MD'), '# Existing', 'utf8')

    await expect(createNote(notesDirectory)).resolves.toMatchObject({
      id: '未命名 2.md',
      title: '未命名 2'
    })
  })

  it('renames the Markdown file and rejects duplicate names', async () => {
    const notesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-notes-'))

    await writeFile(join(notesDirectory, 'Original.md'), '# Content', 'utf8')
    await writeFile(join(notesDirectory, 'Existing.md'), '# Existing', 'utf8')

    await expect(
      renameNote({ id: 'Original.md', name: 'Renamed' }, notesDirectory)
    ).resolves.toMatchObject({
      id: 'Renamed.md',
      title: 'Renamed',
      markdown: '# Content'
    })
    await expect(readFile(join(notesDirectory, 'Renamed.md'), 'utf8')).resolves.toBe('# Content')
    await expect(readFile(join(notesDirectory, 'Original.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(
      renameNote({ id: 'Renamed.md', name: 'existing' }, notesDirectory)
    ).rejects.toThrow('A note named "existing" already exists.')
  })

  it('treats Unicode-equivalent note names as duplicates', async () => {
    const notesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-notes-'))

    await writeFile(join(notesDirectory, 'Cafe\u0301.md'), '# Existing', 'utf8')
    await writeFile(join(notesDirectory, 'Other.md'), '# Other', 'utf8')

    await expect(
      renameNote({ id: 'Other.md', name: 'Café' }, notesDirectory)
    ).rejects.toThrow('A note named "Café" already exists.')
  })

  it('allows changing only the case of the current note name', async () => {
    const notesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-notes-'))

    await writeFile(join(notesDirectory, 'Case Note.md'), '# Content', 'utf8')

    await expect(
      renameNote({ id: 'Case Note.md', name: 'case note' }, notesDirectory)
    ).resolves.toMatchObject({
      id: 'case note.md',
      title: 'case note'
    })
  })

  it('moves a note through the provided recoverable trash operation', async () => {
    const notesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-notes-'))
    const trashDirectory = join(notesDirectory, '.test-trash')

    await mkdir(trashDirectory)
    await writeFile(join(notesDirectory, 'Disposable.md'), '# Recoverable', 'utf8')

    await expect(
      trashNote(
        'Disposable.md',
        async (notePath) => {
          await renameFile(notePath, join(trashDirectory, 'Disposable.md'))
        },
        notesDirectory
      )
    ).resolves.toEqual({ id: 'Disposable.md', deleted: true })
    await expect(readFile(join(notesDirectory, 'Disposable.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(join(trashDirectory, 'Disposable.md'), 'utf8')).resolves.toBe(
      '# Recoverable'
    )
  })

  it('rejects invalid note IDs and oversized Markdown', async () => {
    const notesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-notes-'))
    const createdNote = await createNote(notesDirectory)

    await expect(getNote('../settings.md', notesDirectory)).rejects.toThrow('Note ID is invalid.')
    await expect(getNote('settings.json', notesDirectory)).rejects.toThrow('Note ID is invalid.')
    await expect(
      renameNote({ id: createdNote.id, name: '../renamed' }, notesDirectory)
    ).rejects.toThrow('Note name is invalid.')
    await expect(
      saveNote(
        {
          id: createdNote.id,
          markdown: 'x'.repeat(2 * 1024 * 1024 + 1)
        },
        notesDirectory
      )
    ).rejects.toThrow('Note must be 2 MB or smaller.')
  })
})
