import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DIRECTORY_LIMITS } from '../../scripts/rag-directory-demo.mjs'
import { withNoteProvenance } from '../shared/note-provenance'
import { retrieveNotes, splitApplicationNote } from './rag-note-retrieval'

const configuredDirectory = vi.hoisted(() => vi.fn())
vi.mock('./settings', () => ({ getConfiguredNoteStorageDirectory: configuredDirectory }))
const directories: string[] = []
const UUID = '12345678-1234-1234-1234-123456789abc'
const NOTE = '# used to\n介绍：这是过去习惯的表达。\n\n## 含义\nused to 表示过去的习惯。'
const managedNote = (body = NOTE) => withNoteProvenance(body, { version: 1, note_id: UUID, sources: [] })
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'englishask-rag-'))
  directories.push(directory)
  return directory
}
afterEach(async () => {
  configuredDirectory.mockReset()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('application Notes retrieval', () => {
  it('retrieves body evidence with persisted identity and leaves files unchanged', async () => {
    const directory = await fixture()
    const markdown = managedNote()
    await writeFile(join(directory, 'Study.md'), markdown)
    const result = await retrieveNotes('used to 的含义', { notesDirectory: directory })
    expect(result.matches[0]).toMatchObject({ noteId: 'Study.md', identityKind: 'persisted', noteIdentity: `uuid:${UUID}` })
    expect(result.context).toContain('used to 表示过去的习惯')
    expect(result.context).not.toContain('english_ask')
    expect(await readFile(join(directory, 'Study.md'), 'utf8')).toBe(markdown)
  })

  it('uses the configured directory when no explicit directory is supplied', async () => {
    const directory = await fixture()
    configuredDirectory.mockResolvedValue(directory)
    await writeFile(join(directory, 'Note.md'), NOTE)
    expect((await retrieveNotes('used to')).noteCount).toBe(1)
    expect(configuredDirectory).toHaveBeenCalledOnce()
  })

  it('preserves managed identity, revision and source chunk ID through a rename', async () => {
    const directory = await fixture()
    await writeFile(join(directory, 'Old.md'), managedNote())
    const before = await retrieveNotes('used to 的含义', { notesDirectory: directory })
    await rename(join(directory, 'Old.md'), join(directory, 'New.md'))
    const after = await retrieveNotes('used to 的含义', { notesDirectory: directory })
    expect(after.matches[0].noteId).toBe('New.md')
    expect(after.matches[0].noteIdentity).toBe(before.matches[0].noteIdentity)
    expect(after.matches[0].sourceRevision).toBe(before.matches[0].sourceRevision)
    expect(after.matches[0].sourceChunkId).toBe(before.matches[0].sourceChunkId)
  })

  it('detects edits and removes deleted Notes on the next retrieval', async () => {
    const directory = await fixture()
    const path = join(directory, 'Note.md')
    await writeFile(path, managedNote())
    const before = await retrieveNotes('used to', { notesDirectory: directory })
    await writeFile(path, managedNote(NOTE + '\n新增例句'))
    const after = await retrieveNotes('used to', { notesDirectory: directory })
    expect(after.matches[0].noteIdentity).toBe(before.matches[0].noteIdentity)
    expect(after.matches[0].sourceRevision).not.toBe(before.matches[0].sourceRevision)
    await rm(path)
    expect((await retrieveNotes('used to', { notesDirectory: directory })).matches).toEqual([])
  })

  it('explicitly falls back to filename identity for legacy files without rewriting them', async () => {
    const directory = await fixture()
    await writeFile(join(directory, 'Legacy.md'), 'used to 表示过去的习惯。')
    const result = await retrieveNotes('过去', { notesDirectory: directory })
    expect(result.matches[0]).toMatchObject({ identityKind: 'filename', noteIdentity: 'filename:Legacy.md' })
    expect(await readFile(join(directory, 'Legacy.md'), 'utf8')).toBe('used to 表示过去的习惯。')
  })

  it('rejects duplicate or corrupt managed identities', async () => {
    const directory = await fixture()
    await writeFile(join(directory, 'First.md'), managedNote())
    await writeFile(join(directory, 'Second.md'), managedNote())
    await expect(retrieveNotes('used to', { notesDirectory: directory })).rejects.toThrow('same persisted identity')
    await writeFile(join(directory, 'Second.md'), '---\nenglish_ask: broken\n---\nBody')
    await expect(retrieveNotes('used to', { notesDirectory: directory })).rejects.toThrow('元数据无效')
  })

  it('scopes identical Note identities to different directories', async () => {
    const first = await fixture()
    const second = await fixture()
    await writeFile(join(first, 'Note.md'), managedNote())
    await writeFile(join(second, 'Note.md'), managedNote())
    const left = await retrieveNotes('used to', { notesDirectory: first })
    const right = await retrieveNotes('used to', { notesDirectory: second })
    expect(left.matches[0].sourceChunkId).not.toBe(right.matches[0].sourceChunkId)
  })

  it('retains prefaces and plain Notes and ignores headings inside fenced code', () => {
    const chunks = splitApplicationNote('# Topic\n介绍正文\n## 用法\n```md\n## fake\n```\n实际正文', 'Note.md')
    expect(chunks).toHaveLength(2)
    expect(chunks[0].text).toBe('介绍正文')
    expect(chunks[1].text).toContain('## fake')
    expect(splitApplicationNote('纯正文', 'Note.md')[0].text).toBe('纯正文')
    expect(splitApplicationNote('# 只有标题', 'Note.md')[0].text).toBe('# 只有标题')
    expect(splitApplicationNote('', 'Note.md')).toEqual([])
  })

  it('recognizes Setext headings and excludes frontmatter from search text', () => {
    const chunks = splitApplicationNote('---\ntags: private-tag\n---\nTopic\n=====\nIntro\n\nUsage\n-----\nBody', 'Note.md')
    expect(chunks.map(chunk => chunk.title)).toEqual(['Topic / 全文', 'Topic / Usage'])
    expect(chunks.map(chunk => chunk.text)).toEqual(['Intro', 'Body'])
  })

  it('rejects invalid questions, top-k and corpus overflow before returning results', async () => {
    const directory = await fixture()
    await expect(retrieveNotes('', { notesDirectory: directory })).rejects.toThrow('question')
    await expect(retrieveNotes('a'.repeat(2001), { notesDirectory: directory })).rejects.toThrow('question')
    await expect(retrieveNotes('used to', { notesDirectory: directory, topK: 0 })).rejects.toThrow('top-k')
    await writeFile(join(directory, 'Note.md'), NOTE)
    await expect(retrieveNotes('used to', { notesDirectory: directory,
      limits: { ...DIRECTORY_LIMITS, maxChunks: 1 } })).rejects.toThrow('chunk limit')
  })

  it('honors cancellation before configured storage is accessed', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(retrieveNotes('used to', { signal: controller.signal })).rejects.toThrow()
    expect(configuredDirectory).not.toHaveBeenCalled()
  })

  it('preserves the labeled development evidence on all four synthetic fixture notes', async () => {
    const directory = await fixture()
    for (const filename of ['used-to.md', 'be-used-to.md', 'get-used-to.md', 'present-perfect.md']) {
      const markdown = await readFile(new URL(`../../tests/fixtures/rag/notes/${filename}`, import.meta.url), 'utf8')
      await writeFile(join(directory, filename), markdown)
    }
    const comparison = await retrieveNotes('根据笔记，used to 和 be used to 的含义有什么区别？', { notesDirectory: directory })
    expect(comparison.chunkCount).toBe(12)
    expect(comparison.matches.map(chunk => chunk.title)).toContain('used to / 含义')
    expect(comparison.matches.map(chunk => chunk.title)).toContain('be used to / 含义')
    const exact = await retrieveNotes('used to 后面接什么形式的动词？', { notesDirectory: directory })
    expect(exact.matches.map(chunk => chunk.title)).toContain('used to / 结构')
    expect((await retrieveNotes('根据我的笔记解释虚拟语气倒装。', { notesDirectory: directory })).matches).toEqual([])
  })

  it('does not strip horizontal-rule-delimited body text as frontmatter', () => {
    const markdown = 'Intro\n\n---\nBody\n\n---\nTail'
    expect(splitApplicationNote(markdown, 'Note.md')[0].text).toBe(markdown)
  })
})
