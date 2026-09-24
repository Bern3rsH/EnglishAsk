import { lstat, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNotesSynchronizer, type NotesSyncSnapshot } from '../renderer/src/notes-sync'
import { getNote, listNotes } from './note-storage'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, lstat: vi.fn(actual.lstat) }
})

const testDirectories: string[] = []
const createTestDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'english-ask-sync-test-'))
  testDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  vi.clearAllMocks()
})

describe('external Markdown directory changes', () => {
  it('synchronizes real create, edit, rename, and delete operations without writing through the app', async () => {
    const directory = await createTestDirectory()
    const snapshot: NotesSyncSnapshot = {
      activeNoteId: null, markdown: '', notes: [], isDirty: false, isBusy: false, revision: 0
    }
    const onError = vi.fn()
    const synchronizer = createNotesSynchronizer({
      getSnapshot: () => snapshot,
      listNotes: async () => ({ ok: true, data: await listNotes(directory) }),
      getNote: async (noteId) => ({ ok: true, data: await getNote(noteId, directory) }),
      onNotes: (notes) => { snapshot.notes = notes },
      onDocument: (note) => {
        snapshot.activeNoteId = note.id
        snapshot.markdown = note.markdown
        snapshot.revision += 1
      },
      onEmpty: () => {
        snapshot.activeNoteId = null
        snapshot.markdown = ''
        snapshot.revision += 1
      },
      onError
    })
    const notePath = join(directory, 'Original.md')
    const renamedPath = join(directory, 'Renamed.MD')
    const otherPath = join(directory, 'Other.md')

    await synchronizer.refresh()
    expect(snapshot.notes).toEqual([])
    await writeFile(notePath, '## Original\n\nContent.\n')
    await writeFile(join(directory, 'asset.txt'), 'Not a Note')
    await synchronizer.refresh()
    expect(snapshot.activeNoteId).toBe('Original.md')
    expect(snapshot.markdown).toBe('## Original\n\nContent.\n')
    expect(snapshot.notes).toHaveLength(1)

    await writeFile(notePath, '## Changed outside\n\n**Exact Markdown.**\n')
    await synchronizer.refresh()
    expect(snapshot.markdown).toBe('## Changed outside\n\n**Exact Markdown.**\n')

    await rename(notePath, renamedPath)
    await synchronizer.refresh()
    expect(snapshot.activeNoteId).toBe('Renamed.MD')
    expect(snapshot.notes.map((note) => note.id)).toEqual(['Renamed.MD'])

    await writeFile(otherPath, 'Other')
    await synchronizer.refresh()
    expect(snapshot.notes).toHaveLength(2)
    expect(snapshot.activeNoteId).toBe('Renamed.MD')
    await unlink(otherPath)
    await synchronizer.refresh()
    expect(snapshot.notes).toHaveLength(1)

    await unlink(renamedPath)
    await synchronizer.refresh()
    expect(snapshot.activeNoteId).toBeNull()
    expect(snapshot.markdown).toBe('')
    expect(snapshot.notes).toEqual([])
    expect(onError.mock.calls.every(([message]) => message === null)).toBe(true)
    await expect(readFile(renamedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    synchronizer.dispose()
  })

  it('tolerates a file disappearing between directory listing and metadata lookup', async () => {
    const directory = await createTestDirectory()
    const notePath = join(directory, 'Disappearing.md')
    await writeFile(notePath, 'Content')
    vi.mocked(lstat).mockImplementationOnce(async () => {
      await unlink(notePath)
      throw Object.assign(new Error('File removed during scan'), { code: 'ENOENT' })
    })

    await expect(listNotes(directory)).resolves.toEqual([])
    await expect(listNotes(directory)).resolves.toEqual([])
  })
})
