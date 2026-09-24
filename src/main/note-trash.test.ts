import { mkdir, mkdtemp, readFile, rename as renameFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shell } from 'electron'
import { moveNoteToSystemTrash } from './note-trash'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn()
  },
  shell: {
    trashItem: vi.fn()
  }
}))

describe('note trash', () => {
  beforeEach(() => {
    vi.mocked(shell.trashItem).mockReset()
  })

  it('reports missing notes before moving anything to trash', async () => {
    const notesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-note-trash-'))

    await expect(
      moveNoteToSystemTrash('Missing.md', { notesDirectory })
    ).rejects.toThrow('Note was not found.')
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('moves the Markdown file to trash', async () => {
    const notesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-note-trash-'))
    const trashDirectory = join(notesDirectory, '.test-trash')
    const notePath = join(notesDirectory, 'Remove me.md')
    const trashedNotePath = join(trashDirectory, 'Remove me.md')

    await mkdir(trashDirectory)
    await writeFile(notePath, '# Remove me', 'utf8')
    vi.mocked(shell.trashItem).mockImplementation(async (sourcePath) => {
      await renameFile(sourcePath, trashedNotePath)
    })

    await expect(moveNoteToSystemTrash('Remove me.md', { notesDirectory })).resolves.toEqual({
      id: 'Remove me.md',
      deleted: true
    })
    expect(shell.trashItem).toHaveBeenCalledWith(notePath)
    await expect(readFile(notePath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(trashedNotePath, 'utf8')).resolves.toBe('# Remove me')
  })
})
