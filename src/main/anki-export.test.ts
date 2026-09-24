import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { exportAnkiCards, formatAnkiExport, getAnkiExportFileName } from './anki-export'
import { createNote, saveNote } from './note-storage'
import { loadAnkiDrafts, saveAnkiDrafts } from './anki-drafts'
import { readNoteProvenance } from '../shared/note-provenance'
import type { AnkiDraftSet } from '../shared/anki'

const directories: string[] = []
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'englishask-export-'))
  directories.push(directory)
  const note = await createNote(directory, 'Learning content', '学习内容')
  const request = { noteId: note.id, expectedMarkdown: note.markdown, expectedDirectory: directory }
  const drafts: AnkiDraftSet = { version: 1, revision: 'new', sourceTitle: note.title,
    sourceNoteId: readNoteProvenance(note.markdown)!.note_id,
    sourceRevision: createHash('sha256').update('Learning content').digest('hex'),
    cards: [
      { id: 'one', front: '中文 "question"\tline\n<script>x</script>', back: 'An answer & <tag>', explanation: 'Extra\r\ncontext', tags: ['句型', 'test"quote'], selected: true },
      { id: 'two', front: 'Unchecked', back: 'Do not export', explanation: '', tags: [], selected: false }
    ] }
  const saved = await saveAnkiDrafts({ ...request, drafts, expectedDraftRevision: null }, directory)
  return { directory, note, drafts: saved, request: { ...request, expectedDraftRevision: saved.revision } }
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

it('exports only selected cards as escaped UTF-8 Anki text and keeps all drafts', async () => {
  const { directory, note, request, drafts } = await fixture()
  const path = join(directory, 'cards.txt')
  const choose = vi.fn().mockResolvedValue(path)
  expect(await exportAnkiCards(request, choose, directory)).toEqual({ cancelled: false, filePath: path, count: 1 })
  expect(choose).toHaveBeenCalledWith('学习内容-Anki.txt')
  const text = await readFile(path, 'utf8')
  expect(text).toContain('#separator:Tab\n#html:true\n#notetype:Basic\n#tags column:3\n#columns:Front\tBack\tTags\n')
  expect(text).toContain('中文 &quot;question&quot;&#9;line<br>&lt;script&gt;x&lt;/script&gt;')
  expect(text).toContain('An answer &amp; &lt;tag&gt;')
  expect(text).toContain('<hr><div>Extra<br>context</div>')
  expect(text).toContain('test""quote')
  expect(text).toContain(drafts.sourceNoteId)
  expect(text).not.toContain('Unchecked')
  expect(text).not.toContain('<script>')
  expect(text.trimEnd().split('\n')).toHaveLength(6)
  expect((await loadAnkiDrafts(request, directory)).drafts).toEqual(drafts)
  expect(await readFile(join(directory, note.id), 'utf8')).toBe(note.markdown)
})

it('writes nothing when the save dialog is cancelled', async () => {
  const { directory, request } = await fixture()
  const before = await readdir(directory)
  expect(await exportAnkiCards(request, async () => undefined, directory)).toEqual({ cancelled: true })
  expect(await readdir(directory)).toEqual(before)
})

it('blocks stale drafts, changed sources and empty selection before opening the dialog', async () => {
  const { directory, note, request, drafts } = await fixture()
  const choose = vi.fn()
  await expect(exportAnkiCards({ ...request, expectedDraftRevision: 'old' }, choose, directory)).rejects.toThrow('已变更')
  const unchecked = await saveAnkiDrafts({ ...request, drafts: { ...drafts, cards: drafts.cards.map(card => ({ ...card, selected: false })) } }, directory)
  await expect(exportAnkiCards({ ...request, expectedDraftRevision: unchecked.revision }, choose, directory)).rejects.toThrow('至少勾选')
  await saveNote({ id: note.id, markdown: 'New content' }, directory)
  await expect(exportAnkiCards(request, choose, directory)).rejects.toThrow('Note 内容已变更')
  expect(choose).not.toHaveBeenCalled()
})

it('rechecks the snapshot after the save dialog and preserves an existing export on conflict', async () => {
  const { directory, request, drafts } = await fixture()
  const path = join(directory, 'existing.txt')
  await writeFile(path, 'Previous export')
  await expect(exportAnkiCards(request, async () => {
    await saveAnkiDrafts({ ...request, drafts }, directory)
    return path
  }, directory)).rejects.toThrow('已变更')
  expect(await readFile(path, 'utf8')).toBe('Previous export')
  expect((await readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(false)
})

it('cleans up failed exports and refuses to overwrite a Markdown file', async () => {
  const { directory, note, request } = await fixture()
  await expect(exportAnkiCards(request, async () => join(directory, note.id), directory)).rejects.toThrow('.txt')
  expect(await readFile(join(directory, note.id), 'utf8')).toBe(note.markdown)
  await expect(exportAnkiCards(request, async () => join(directory, 'missing', 'cards.txt'), directory)).rejects.toThrow()
  expect((await readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(false)
})

it('sanitizes filenames and does not invent Anki internal GUIDs', async () => {
  expect(getAnkiExportFileName('../bad/name')).not.toContain('/')
  const { drafts } = await fixture()
  expect(formatAnkiExport(drafts).text).not.toContain('#guid column:')
})
