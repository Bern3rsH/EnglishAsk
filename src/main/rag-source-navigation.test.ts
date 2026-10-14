import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withNoteProvenance } from '../shared/note-provenance'
import { retrieveNotes } from './rag-note-retrieval'
import { openNoteAnswerSource } from './rag-source-navigation'

const configuredDirectory = vi.hoisted(() => vi.fn())
vi.mock('./settings', () => ({ getConfiguredNoteStorageDirectory: configuredDirectory }))
const directories: string[] = []
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'englishask-rag-source-'))
  directories.push(directory)
  configuredDirectory.mockResolvedValue(directory)
  const markdown = withNoteProvenance('# used to\n## 含义\nused to 表示过去的习惯。', {
    version: 1, note_id: '12345678-1234-1234-1234-123456789abc', sources: []
  })
  await writeFile(join(directory, 'Study.md'), markdown)
  const chunk = (await retrieveNotes('used to', { notesDirectory: directory })).matches[0]
  return { directory, markdown, source: { ...chunk, sourceId: 'S1', quote: chunk.text } }
}
afterEach(async () => {
  configuredDirectory.mockReset()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('validated source navigation', () => {
  it('opens an unchanged source and resolves managed identity after rename', async () => {
    const { directory, source, markdown } = await fixture()
    expect((await openNoteAnswerSource(source)).markdown).toBe(markdown)
    await rename(join(directory, 'Study.md'), join(directory, 'Renamed.md'))
    expect((await openNoteAnswerSource(source)).id).toBe('Renamed.md')
  })
  it('rejects stale evidence after content edits', async () => {
    const { directory, source, markdown } = await fixture()
    await writeFile(join(directory, 'Study.md'), markdown + '\nChanged')
    await expect(openNoteAnswerSource(source)).rejects.toThrow('内容已更新')
  })
  it('rejects deleted sources', async () => {
    const { directory, source } = await fixture()
    await rm(join(directory, 'Study.md'))
    await expect(openNoteAnswerSource(source)).rejects.toThrow('已删除')
  })
  it('rejects sources from a different configured directory', async () => {
    const { source } = await fixture()
    const other = await mkdtemp(join(tmpdir(), 'englishask-rag-other-'))
    directories.push(other)
    configuredDirectory.mockResolvedValue(other)
    await expect(openNoteAnswerSource(source)).rejects.toThrow('目录已变更')
  })
  it('rejects forged chunk identities or content even with a valid file revision', async () => {
    const { source } = await fixture()
    await expect(openNoteAnswerSource({ ...source, sourceChunkId: 'a'.repeat(64) })).rejects.toThrow('不一致')
    await expect(openNoteAnswerSource({ ...source, title: 'Forged title' })).rejects.toThrow('不一致')
    await expect(openNoteAnswerSource({ ...source, text: source.text + ' extra' })).rejects.toThrow('不一致')
  })
  it('rejects invalid source paths and unknown source shapes before accessing storage', async () => {
    await expect(openNoteAnswerSource(null)).rejects.toThrow('信息无效')
    expect(configuredDirectory).not.toHaveBeenCalled()
    const { source } = await fixture()
    await expect(openNoteAnswerSource({ ...source, noteId: '../outside.md' })).rejects.toThrow('信息无效')
  })
})
