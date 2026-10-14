import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DIRECTORY_LIMITS, loadDirectoryChunks } from './rag-directory-demo.mjs'
import { retrieveChunksWithPhraseBm25 } from './rag-phrase-bm25.mjs'

const NOTE = '# used to\n\n## 含义\nused to 表示过去的习惯。\n\n## 结构\nused to + 动词原形。\n'
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rag-directory-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('reads notes with source versions and preserves them through retrieval without writes', async t => {
  const directory = await setup(t)
  const path = join(directory, 'used-to.md')
  await writeFile(path, NOTE)
  await writeFile(join(directory, 'ignored.txt'), 'outside the corpus')
  const loaded = await loadDirectoryChunks(directory)
  assert.equal(loaded.noteCount, 1)
  assert.equal(loaded.totalBytes, Buffer.byteLength(NOTE))
  assert.equal(loaded.chunks.length, 2)
  assert.equal(loaded.chunks[0].source, 'used-to.md')
  assert.match(loaded.chunks[0].sourceRevision, /^[a-f0-9]{64}$/)
  assert.notEqual(loaded.chunks[0].sourceChunkId, loaded.chunks[1].sourceChunkId)
  const retrieval = retrieveChunksWithPhraseBm25(loaded.chunks, 'used to 的含义')
  assert.equal(retrieval.matches[0].sourceRevision, loaded.chunks[0].sourceRevision)
  assert.equal(await readFile(retrieval.matches[0].sourcePath, 'utf8'), NOTE)
})

test('reloading unchanged content preserves IDs; edits change versions and IDs', async t => {
  const directory = await setup(t)
  const path = join(directory, 'used-to.md')
  await writeFile(path, NOTE)
  const first = await loadDirectoryChunks(directory)
  const second = await loadDirectoryChunks(directory)
  assert.deepEqual(first, second)
  await writeFile(path, NOTE.replace('过去的习惯', '过去的状态'))
  const third = await loadDirectoryChunks(directory)
  assert.notEqual(first.chunks[0].sourceRevision, third.chunks[0].sourceRevision)
  assert.notEqual(first.chunks[0].sourceChunkId, third.chunks[0].sourceChunkId)
})

test('normalizes CRLF for chunking but hashes the original bytes', async t => {
  const directory = await setup(t)
  await writeFile(join(directory, 'note.MD'), NOTE.replaceAll('\n', '\r\n'))
  const loaded = await loadDirectoryChunks(directory)
  assert.equal(loaded.chunks.length, 2)
  assert.ok(!loaded.chunks[0].text.includes('\r'))
})

test('empty directories return no chunks and non-section notes fail explicitly', async t => {
  const directory = await setup(t)
  assert.deepEqual((await loadDirectoryChunks(directory)).chunks, [])
  await writeFile(join(directory, 'note.md'), '# Topic\nBody without sections')
  await assert.rejects(loadDirectoryChunks(directory), /requires ##/)
})

test('rejects linked Markdown files and linked root directories', async t => {
  const directory = await setup(t)
  const outside = await setup(t)
  await writeFile(join(outside, 'note.md'), NOTE)
  await symlink(join(outside, 'note.md'), join(directory, 'linked.md'))
  await assert.rejects(loadDirectoryChunks(directory), /regular files/)
  const link = join(outside, 'directory-link')
  await symlink(directory, link)
  await assert.rejects(loadDirectoryChunks(link), /regular directory/)
})

test('enforces note and directory-entry limits', async t => {
  const directory = await setup(t)
  await writeFile(join(directory, 'one.md'), NOTE)
  await writeFile(join(directory, 'two.md'), NOTE)
  await assert.rejects(loadDirectoryChunks(directory, { ...DIRECTORY_LIMITS, maxNotes: 1 }), /note limit/)
  await assert.rejects(loadDirectoryChunks(directory, { ...DIRECTORY_LIMITS, maxEntries: 1 }), /entry limit/)
})

test('enforces file and combined byte budgets', async t => {
  const directory = await setup(t)
  await writeFile(join(directory, 'one.md'), NOTE)
  const bytes = Buffer.byteLength(NOTE)
  await assert.rejects(loadDirectoryChunks(directory, { ...DIRECTORY_LIMITS, maxFileBytes: bytes - 1 }), /byte budget/)
  await writeFile(join(directory, 'two.md'), NOTE)
  await assert.rejects(loadDirectoryChunks(directory, { ...DIRECTORY_LIMITS, maxTotalBytes: bytes * 2 - 1 }), /byte budget/)
})

test('enforces chunk limits and rejects invalid UTF-8', async t => {
  const directory = await setup(t)
  const path = join(directory, 'note.md')
  await writeFile(path, NOTE)
  await assert.rejects(loadDirectoryChunks(directory, { ...DIRECTORY_LIMITS, maxChunks: 1 }), /chunk limit/)
  await writeFile(path, Buffer.from([0xff]))
  await assert.rejects(loadDirectoryChunks(directory), /encoded data/)
})

test('rejects missing paths and invalid limits', async t => {
  const directory = await setup(t)
  await assert.rejects(loadDirectoryChunks(''), /path is required/)
  await assert.rejects(loadDirectoryChunks(join(directory, 'missing')), /ENOENT/)
  await assert.rejects(loadDirectoryChunks(directory, { ...DIRECTORY_LIMITS, maxNotes: 0 }), /Invalid/)
  await assert.rejects(loadDirectoryChunks(directory, { ...DIRECTORY_LIMITS, maxFileBytes: Infinity }), /Invalid/)
})

test('supports an application splitter and checks cancellation during loading', async t => {
  const directory = await setup(t)
  await writeFile(join(directory, 'note.md'), 'plain body')
  const splitNote = (text, source) => [{ source, title: 'Topic / Full', text }]
  const loaded = await loadDirectoryChunks(directory, DIRECTORY_LIMITS, { splitNote })
  assert.equal(loaded.chunks[0].text, 'plain body')
  assert.equal(loaded.notes[0].markdown, 'plain body')
  const controller = new AbortController()
  await assert.rejects(loadDirectoryChunks(directory, DIRECTORY_LIMITS, {
    signal: controller.signal,
    splitNote(text, source) {
      controller.abort()
      return splitNote(text, source)
    }
  }), /abort/i)
})

test('rejects invalid custom splitter output', async t => {
  const directory = await setup(t)
  await writeFile(join(directory, 'note.md'), NOTE)
  await assert.rejects(loadDirectoryChunks(directory, DIRECTORY_LIMITS, {
    splitNote: () => [{ source: 'another.md', title: 'Title', text: 'Body' }]
  }), /invalid chunks/)
})

test('CLI retrieves all four fixture notes and omits bodies and absolute paths', () => {
  const entrypoint = new URL('./rag-directory-demo.mjs', import.meta.url).pathname
  const success = spawnSync(process.execPath, [entrypoint], { encoding: 'utf8' })
  assert.equal(success.status, 0, success.stderr)
  const output = JSON.parse(success.stdout)
  assert.equal(output.noteCount, 4)
  assert.equal(output.chunkCount, 12)
  assert.equal(output.generationCalled, false)
  assert.ok(output.matches.some(item => item.title === 'used to / 含义'))
  assert.ok(output.matches.some(item => item.title === 'be used to / 含义'))
  assert.ok(output.matches.every(item => !('text' in item) && !('sourcePath' in item)))
  const failure = spawnSync(process.execPath, [entrypoint, '/missing-rag-directory'], { encoding: 'utf8' })
  assert.equal(failure.status, 1)
  assert.ok(!failure.stderr.includes('/missing-rag-directory'))
})
