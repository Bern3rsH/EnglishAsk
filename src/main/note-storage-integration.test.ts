import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import { saveNoteImage } from './note-assets'
import { createNote, renameNote, saveNote } from './note-storage'
import { setConfiguredNoteStorageDirectory } from './settings'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn()
  }
}))

describe('configured note storage integration', () => {
  beforeEach(async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'english-ask-user-data-'))
    vi.mocked(app.getPath).mockReturnValue(userDataDirectory)
  })

  it('writes Markdown and image assets into the selected local directory', async () => {
    const customNotesDirectory = await mkdtemp(join(tmpdir(), 'english-ask-local-notes-'))

    await setConfiguredNoteStorageDirectory(customNotesDirectory)

    const note = await createNote()
    await saveNote({
      id: note.id,
      markdown: '# Stored locally'
    })
    const renamedNote = await renameNote({
      id: note.id,
      name: 'Configured note'
    })
    const image = await saveNoteImage({
      fileName: 'example.png',
      mimeType: 'image/png',
      data: new Uint8Array([137, 80, 78, 71]).buffer
    })

    await expect(
      readFile(join(customNotesDirectory, renamedNote.id), 'utf8')
    ).resolves.toBe(renamedNote.markdown)
    await expect(readFile(join(customNotesDirectory, note.id), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(fileURLToPath(image.url).startsWith(join(customNotesDirectory, 'note-assets'))).toBe(
      true
    )
  })
})
