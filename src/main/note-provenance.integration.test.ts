import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createNote, getNote, listNotes, renameNote, saveNote } from './note-storage'
import { readNoteProvenance, withNoteProvenance, withoutNoteProvenance } from '../shared/note-provenance'

const directories: string[] = []
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'englishask-provenance-'))
  directories.push(directory)
  return directory
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('persisted Note identity and sources', () => {
  it('keeps identity and multiple sources across manual edits, rename, reread, update and undo', async () => {
    const directory = await fixture()
    const original = await createNote(directory, 'Original', 'Study')
    const metadata = readNoteProvenance(original.markdown)!
    const update = await saveNote({ id: original.id,
      markdown: withNoteProvenance('Updated', { ...metadata, sources: [
        { ask_id: 'ask-1', message_ids: ['q', 'a'] },
        { ask_id: 'ask-2', message_ids: ['q2', 'a2'] }
      ] }), expectedMarkdown: original.markdown, expectedDirectory: directory, preservePrevious: true
    }, directory)
    const restored = await saveNote({ id: original.id, restorePrevious: true,
      expectedMarkdown: update.markdown, expectedDirectory: directory }, directory)
    expect(restored.markdown).toBe(original.markdown)
    expect(readNoteProvenance(restored.markdown)).toEqual(metadata)
    const reapplied = await saveNote({ id: original.id, markdown: update.markdown }, directory)
    const edited = await saveNote({ id: original.id, markdown: 'Handwritten edit' }, directory)
    expect(readNoteProvenance(edited.markdown)).toEqual(readNoteProvenance(reapplied.markdown))
    const renamed = await renameNote({ id: original.id, name: 'New name' }, directory)
    expect(readNoteProvenance(renamed.markdown)?.note_id).toBe(metadata.note_id)
    expect(renamed.markdown).toBe(edited.markdown)
    expect((await getNote(renamed.id, directory)).markdown).toBe(await readFile(join(directory, renamed.id), 'utf8'))
  })

  it('leaves legacy files untouched during reads and adds identity on first save without fabricating sources', async () => {
    const directory = await fixture()
    const path = join(directory, 'Legacy.md')
    const body = '---\ncustom: original\n---\nA complete note'
    await writeFile(path, body)
    await listNotes(directory)
    expect((await getNote('Legacy.md', directory)).markdown).toBe(body)
    expect(await readFile(path, 'utf8')).toBe(body)
    const saved = await saveNote({ id: 'Legacy.md', markdown: body }, directory)
    expect(withoutNoteProvenance(saved.markdown)).toBe(body)
    expect(readNoteProvenance(saved.markdown)?.sources).toEqual([])
  })

  it('retains a newly assigned legacy identity after undoing its first AI update', async () => {
    const directory = await fixture()
    await writeFile(join(directory, 'Legacy.md'), 'Legacy')
    const updated = await saveNote({ id: 'Legacy.md', markdown: 'New', expectedMarkdown: 'Legacy',
      expectedDirectory: directory, preservePrevious: true }, directory)
    const restored = await saveNote({ id: 'Legacy.md', restorePrevious: true,
      expectedMarkdown: updated.markdown, expectedDirectory: directory }, directory)
    expect(withoutNoteProvenance(restored.markdown)).toBe('Legacy')
    expect(readNoteProvenance(restored.markdown)?.note_id).toBe(readNoteProvenance(updated.markdown)?.note_id)
    expect(restored.canUndoUpdate).not.toBe(true)
  })

  it('rejects stale metadata snapshots and malformed stored metadata without overwriting files', async () => {
    const directory = await fixture()
    const note = await createNote(directory, 'Body')
    const path = join(directory, note.id)
    const changed = withNoteProvenance('Body', { ...readNoteProvenance(note.markdown)!, sources: [{ ask_id: 'external', message_ids: ['q'] }] })
    await writeFile(path, changed)
    await expect(saveNote({ id: note.id, markdown: 'New', expectedMarkdown: note.markdown,
      expectedDirectory: directory, preservePrevious: true }, directory)).rejects.toThrow('内容已变更')
    expect(await readFile(path, 'utf8')).toBe(changed)
    const corrupt = '---\nenglish_ask: broken\n---\nBody'
    await writeFile(path, corrupt)
    expect((await getNote(note.id, directory)).markdown).toBe(corrupt)
    await expect(saveNote({ id: note.id, markdown: 'New' }, directory)).rejects.toThrow('元数据无效')
    expect(await readFile(path, 'utf8')).toBe(corrupt)
  })
})
