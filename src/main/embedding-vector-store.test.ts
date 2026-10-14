import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EmbeddingVectorCache, MAX_INDEX_WINDOWS, windowVectorKey } from './embedding-vector-cache'
import { EmbeddingVectorStore, MAX_CACHE_BYTES } from './embedding-vector-store'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const key = windowVectorKey([1, 2, 3])
const vector = Array(1024).fill(0.1)
function populated() {
  const cache = new EmbeddingVectorCache()
  cache.commit('notes', new Map([['chunk', [key]]]), new Map([[key, vector]]))
  return cache
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'embedding-cache-test-'))
  directories.push(directory)
  const warn = vi.fn()
  const store = new EmbeddingVectorStore(async () => directory, warn)
  return { directory, target: join(directory, 'vectors.json'), store, warn }
}

it('persists and restores across new instances, skipping unchanged writes and pruning unused vectors', async () => {
  const { store, directory, target, warn } = await fixture()
  const cache = populated()
  await store.save(cache)
  const before = await stat(target)
  const restored = new EmbeddingVectorCache()
  const restarted = new EmbeddingVectorStore(async () => directory, warn)
  await restarted.restore(restored, 'notes')
  expect(restored.get('notes', key)).toEqual(vector)
  await restarted.save(restored)
  expect((await stat(target)).mtimeMs).toBe(before.mtimeMs)
  restored.commit('notes', new Map(), new Map())
  await restarted.save(restored)
  expect(JSON.parse(await readFile(target, 'utf8')).vectors).toEqual([])
  expect(await readdir(directory)).toEqual(['vectors.json'])
  expect(warn).not.toHaveBeenCalled()
})

it('treats missing files as empty and ignores interrupted temporary writes', async () => {
  const { store, directory, warn } = await fixture()
  await writeFile(join(directory, 'vectors-interrupted.tmp'), '{broken')
  const cache = new EmbeddingVectorCache()
  await store.restore(cache, 'notes')
  expect(cache.snapshot()).toBeUndefined()
  expect(warn).not.toHaveBeenCalled()
})

it('rejects malformed JSON, oversized files and symlink files without exposing contents', async () => {
  const { store, directory, target, warn } = await fixture()
  const cache = new EmbeddingVectorCache()
  await writeFile(target, 'private malformed content')
  await store.restore(cache, 'notes')
  await truncate(target, MAX_CACHE_BYTES + 1)
  await store.restore(cache, 'notes')
  await rm(target)
  await writeFile(join(directory, 'other'), JSON.stringify(populated().snapshot()))
  await symlink(join(directory, 'other'), target)
  await store.restore(cache, 'notes')
  expect(cache.snapshot()).toBeUndefined()
  expect(warn).toHaveBeenCalledTimes(3)
  expect(JSON.stringify(warn.mock.calls)).not.toContain('private malformed content')
})

it('validates versions, model, scope, counts, keys and every vector before publishing', () => {
  const original = populated().snapshot()!
  const invalid = [
    null, { ...original, formatVersion: 999 }, { ...original, modelSha256: 'other-model' },
    { ...original, processingVersion: 999 }, { ...original, contextSize: 4096 },
    { ...original, directoryScopeId: 'other-directory' }, { ...original, vectors: 'invalid' },
    { ...original, vectors: Array(MAX_INDEX_WINDOWS + 1).fill([key, vector]) },
    { ...original, vectors: [[key, vector], [key, vector]] },
    { ...original, vectors: [['invalid-key', vector]] },
    ...[[1], Array(1024).fill(0), Array(1024).fill(NaN), Array(1024).fill(Infinity),
      Array(1024).fill(1e308)].map(bad => ({ ...original, vectors: [[key, vector], [windowVectorKey([4]), bad]] }))
  ]
  for (const saved of invalid) {
    const cache = populated()
    const before = cache.snapshot()
    expect(() => cache.restore('notes', saved)).toThrow()
    expect(cache.snapshot()).toEqual(before)
  }
})

it('keeps memory and the previous disk file on save failure, then retries successfully', async () => {
  const { directory, target, warn } = await fixture()
  let fail = false
  const store = new EmbeddingVectorStore(async () => {
    if (fail) throw new Error('private disk error')
    return directory
  }, warn)
  const cache = populated()
  await store.save(cache)
  const before = await readFile(target, 'utf8')
  cache.commit('notes', new Map(), new Map())
  fail = true
  await expect(store.save(cache)).resolves.toBeUndefined()
  expect(cache.snapshot()!.vectors).toEqual([])
  expect(await readFile(target, 'utf8')).toBe(before)
  expect(warn).toHaveBeenCalledWith('save', expect.any(String))
  fail = false
  await store.save(cache)
  expect(JSON.parse(await readFile(target, 'utf8')).vectors).toEqual([])
})

it('replaces a corrupted cache after a failed restore, even with previously saved identical memory data', async () => {
  const { store, target } = await fixture()
  const cache = populated()
  await store.save(cache)
  await writeFile(target, '{broken')
  await store.restore(cache, 'notes')
  await store.save(cache)
  expect(JSON.parse(await readFile(target, 'utf8')).vectors).toEqual([[key, vector]])
})

it('cleans temporary files after a failed replacement and rejects symlink cache directories', async () => {
  const { directory, target, store, warn } = await fixture()
  await mkdir(target)
  await store.save(populated()) // replacing a directory must fail after the temporary file was written
  expect(await readdir(directory)).toEqual(['vectors.json'])
  expect(warn).toHaveBeenCalledWith('save', expect.any(String))
  const link = join(directory, 'linked-directory')
  await symlink(directory, link, 'dir')
  const unsafe = new EmbeddingVectorStore(async () => link, warn)
  const cache = new EmbeddingVectorCache()
  await unsafe.restore(cache, 'notes')
  await unsafe.save(populated())
  expect(cache.snapshot()).toBeUndefined()
  expect(warn.mock.calls.map(call => call[0])).toEqual(['save', 'restore', 'save'])
})
