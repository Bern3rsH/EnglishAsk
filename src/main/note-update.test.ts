import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { replaceNoteBody, withoutNoteProvenance } from '../shared/note-provenance'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createNote, getNote, listNotes, saveNote } from './note-storage'

const directories: string[] = []
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'englishask-update-'))
  directories.push(directory)
  const note = await createNote(directory, 'Original handwritten note', 'Study')
  const update = { id: note.id, markdown: replaceNoteBody(note.markdown, 'Merged AI note'), expectedMarkdown: note.markdown,
    expectedDirectory: directory, preservePrevious: true }
  return { directory, note, update }
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('guarded Note updates', () => {
  it('persists the previous version, exposes recovery on reread, and restores it once', async () => {
    const { directory, note, update } = await fixture()
    expect((await saveNote(update, directory)).canUndoUpdate).toBe(true)
    expect((await getNote(note.id, directory)).canUndoUpdate).toBe(true)
    expect(await listNotes(directory)).toHaveLength(1)
    const restore = { id: note.id, restorePrevious: true, expectedDirectory: directory,
      expectedMarkdown: update.markdown }
    expect(await saveNote(restore, directory)).toMatchObject({ markdown: note.markdown })
    expect((await getNote(note.id, directory)).canUndoUpdate).not.toBe(true)
    await expect(saveNote(restore, directory)).rejects.toThrow('内容已变更')
  })
  it('rejects stale previews and leaves newer edits intact', async () => {
    const { directory, note, update } = await fixture()
    await writeFile(join(directory, note.id), 'External edits')
    await expect(saveNote(update, directory)).rejects.toThrow('内容已变更')
    expect((await getNote(note.id, directory)).markdown).toBe('External edits')
  })
  it('does not undo over edits made after an AI update', async () => {
    const { directory, note, update } = await fixture()
    await saveNote(update, directory)
    const edited = await saveNote({ id: note.id, markdown: 'My later edits' }, directory)
    expect((await getNote(note.id, directory)).canUndoUpdate).not.toBe(true)
    await expect(saveNote({ id: note.id, restorePrevious: true,
      expectedMarkdown: edited.markdown, expectedDirectory: directory }, directory))
      .rejects.toThrow('没有可撤销')
    expect(withoutNoteProvenance((await getNote(note.id, directory)).markdown)).toBe('My later edits')
  })
  it('rejects a different storage directory even for a same-named file', async () => {
    const first = await fixture()
    const second = await fixture()
    await expect(saveNote(first.update, second.directory)).rejects.toThrow('目录已变更')
    expect((await getNote(second.note.id, second.directory)).markdown).toBe(second.note.markdown)
  })
  it('serializes competing updates so only one original preview can be applied', async () => {
    const { directory, update } = await fixture()
    const results = await Promise.allSettled([
      saveNote(update, directory), saveNote({ ...update, markdown: 'Other update' }, directory)
    ])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
  })
  it('preserves only the latest AI update and ignores unchanged updates', async () => {
    const { directory, note, update } = await fixture()
    await saveNote(update, directory)
    await saveNote({ ...update, expectedMarkdown: update.markdown }, directory)
    const second = await saveNote({ ...update, expectedMarkdown: update.markdown, markdown: 'Second update' }, directory)
    const restored = await saveNote({ id: note.id, restorePrevious: true,
      expectedDirectory: directory, expectedMarkdown: second.markdown }, directory)
    expect(restored.markdown).toBe(update.markdown)
  })
  it('refuses to overwrite the note when backup storage fails', async () => {
    const { directory, note, update } = await fixture()
    await writeFile(join(directory, '.englishask-versions'), 'blocked')
    await expect(saveNote(update, directory)).rejects.toThrow()
    expect((await getNote(note.id, directory)).markdown).toBe(note.markdown)
  })
  it('keeps notes readable if recovery metadata is corrupt', async () => {
    const { directory, note, update } = await fixture()
    await saveNote(update, directory)
    const backupDirectory = join(directory, '.englishask-versions')
    const [backup] = await readdir(backupDirectory)
    await writeFile(join(backupDirectory, backup), 'broken JSON')
    expect((await getNote(note.id, directory)).markdown).toBe(update.markdown)
    expect((await getNote(note.id, directory)).canUndoUpdate).not.toBe(true)
  })
  it('requires a snapshot for guarded saves and restores', async () => {
    const { directory, update } = await fixture()
    await expect(saveNote({ ...update, expectedMarkdown: undefined }, directory)).rejects.toThrow('需要原内容')
    await expect(saveNote({ id: update.id, restorePrevious: true }, directory)).rejects.toThrow('需要原内容')
  })
})
