import { afterEach, expect, it, vi } from 'vitest'
import { LocalEmbeddingRetriever, cosineSimilarity } from './local-embedding'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EmbeddingVectorStore } from './embedding-vector-store'
const mocks = vi.hoisted(() => ({ embed: vi.fn(), tokenize: vi.fn(), dispose: vi.fn(), create: vi.fn(), load: vi.fn(), get: vi.fn() }))
vi.mock('node-llama-cpp', () => ({ getLlama: mocks.get, LlamaLogLevel: { error: 'error' } }))
function runtime() {
  mocks.dispose.mockResolvedValue(undefined)
  mocks.embed.mockResolvedValue({ vector: Array(1024).fill(1) })
  mocks.tokenize.mockImplementation((text: string) => Array.from(text, character => character.codePointAt(0)!))
  mocks.create.mockResolvedValue({ getEmbeddingFor: mocks.embed, dispose: mocks.dispose })
  mocks.load.mockResolvedValue({ tokenize: mocks.tokenize, createEmbeddingContext: mocks.create, dispose: mocks.dispose })
  mocks.get.mockResolvedValue({ loadModel: mocks.load, dispose: mocks.dispose })
}
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers() })
const chunk = { sourceChunkId: 'a', title: '习惯', text: 'used to' }
it('uses 2K, token windows without dropping content, caches actual input independently of source identity', async () => {
  runtime()
  const service = new LocalEmbeddingRetriever(async () => '/fixture.gguf')
  const long = { ...chunk, text: 'a'.repeat(4200) }
  expect((await service.rank([long], 'past'))![0].score).toBeCloseTo(1)
  expect(mocks.create).toHaveBeenCalledWith({ contextSize: 2048, batchSize: 512, createSignal: expect.any(AbortSignal) })
  expect(mocks.embed.mock.calls.map(call => call[0].length)).toEqual([135, 2040, 2040, 123])
  await service.rank([long], 'past')
  expect(mocks.embed).toHaveBeenCalledTimes(5)
  await service.rank([{ ...long, sourceChunkId: 'b' }], 'past')
  expect(mocks.embed).toHaveBeenCalledTimes(6)
  await service.close(); expect(mocks.dispose).toHaveBeenCalledTimes(3)
})
it('skips native loading when model is missing or disabled', async () => {
  runtime(); const service = new LocalEmbeddingRetriever(async () => undefined)
  expect(await service.rank([chunk], 'test')).toBeUndefined()
  expect(mocks.get).not.toHaveBeenCalled(); await service.close()
})
it('serializes requests, observes cancellation and disposes failed native state', async () => {
  runtime(); const service = new LocalEmbeddingRetriever(async () => '/fixture.gguf')
  const controller = new AbortController()
  mocks.embed.mockImplementationOnce(async () => { controller.abort(); return { vector: Array(1024).fill(1) } })
  await expect(service.rank([chunk], 'test', controller.signal)).rejects.toThrow()
  expect(mocks.dispose).toHaveBeenCalledTimes(3)
  await service.rank([chunk], 'test'); expect(mocks.load).toHaveBeenCalledTimes(2)
  await service.close()
})
it('releases native memory when idle and reloads on the next request', async () => {
  vi.useFakeTimers(); runtime(); const service = new LocalEmbeddingRetriever(async () => '/fixture.gguf')
  await service.rank([chunk], 'test'); await vi.advanceTimersByTimeAsync(60_000)
  expect(mocks.dispose).toHaveBeenCalledTimes(3)
  await service.rank([chunk], 'test'); expect(mocks.load).toHaveBeenCalledTimes(2); await service.close()
})
it('rejects invalid vectors and overflowing queries', async () => {
  expect(cosineSimilarity([1,1], [10,10])).toBeCloseTo(1)
  expect(() => cosineSimilarity([0], [1])).toThrow()
  expect(() => cosineSimilarity([NaN], [1])).toThrow()
  runtime(); const service = new LocalEmbeddingRetriever(async () => '/fixture.gguf')
  await expect(service.rank([chunk], 'a'.repeat(2048))).rejects.toThrow('长度限制'); await service.close()
})

it('shutdown cancels an active request before additional windows run', async () => {
  runtime(); const service = new LocalEmbeddingRetriever(async () => '/fixture.gguf')
  let finish: (value: unknown) => void = () => {}
  let entered: () => void = () => {}
  const evaluating = new Promise<void>(resolve => { entered = resolve })
  mocks.embed.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; entered() }))
  const request = service.rank([chunk], 'test')
  const rejected = expect(request).rejects.toThrow()
  await evaluating
  const closing = service.close()
  finish({ vector: Array(1024).fill(1) })
  await rejected; await closing
  expect(mocks.embed).toHaveBeenCalledTimes(1)
})

it('reuses unchanged/moved inputs, recalculates edits and cleans the last shared reference', async () => {
  runtime(); const service = new LocalEmbeddingRetriever(async () => '/fixture.gguf')
  const first = { ...chunk, sourceChunkId: 'revision1-section0' }
  const duplicate = { ...chunk, sourceChunkId: 'revision1-section1' }
  const other = { sourceChunkId: 'c', title: '例句', text: 'another input' }
  await service.rank([first, duplicate, other], 'test')
  expect(mocks.embed).toHaveBeenCalledTimes(3) // query + two unique document inputs
  const moved = { ...first, sourceChunkId: 'revision2-section8' }
  await service.rank([other, moved], 'test')
  expect(mocks.embed).toHaveBeenCalledTimes(4) // only query; duplicate's vector is still referenced
  await service.rank([other], 'test')
  expect(mocks.embed).toHaveBeenCalledTimes(5)
  await service.rank([other, moved], 'test')
  expect(mocks.embed).toHaveBeenCalledTimes(7) // removed last reference, so returning input recomputes
  await service.rank([other, { ...moved, text: 'used at' }], 'test')
  expect(mocks.embed).toHaveBeenCalledTimes(9) // query + changed input
  await service.close()
})
it('isolates directory scopes and clears a fully deleted corpus without native loading', async () => {
  runtime(); const service = new LocalEmbeddingRetriever(async () => '/fixture.gguf')
  await service.rank([chunk], 'test', undefined, 'directory-a')
  await service.rank([chunk], 'test', undefined, 'directory-b')
  expect(mocks.embed).toHaveBeenCalledTimes(4)
  expect(await service.rank([], 'test', undefined, 'directory-b')).toEqual([])
  expect(mocks.embed).toHaveBeenCalledTimes(4)
  await service.rank([chunk], 'test', undefined, 'directory-b')
  expect(mocks.embed).toHaveBeenCalledTimes(6)
  await service.close()
})
it('keeps the last complete snapshot when inference fails midway', async () => {
  runtime(); const service = new LocalEmbeddingRetriever(async () => '/fixture.gguf')
  await service.rank([chunk], 'test')
  mocks.embed.mockResolvedValueOnce({ vector: Array(1024).fill(1) })
    .mockRejectedValueOnce(new Error('native failure'))
  await expect(service.rank([{ ...chunk, text: 'changed text' }], 'test')).rejects.toThrow('native failure')
  const before = mocks.embed.mock.calls.length
  await service.rank([chunk], 'test')
  expect(mocks.embed.mock.calls.length - before).toBe(1) // old document vector remains usable
  await service.close()
})

it('restores after restart, embeds only changed inputs and persists deletion against current notes', async () => {
  runtime()
  const directory = await mkdtemp(join(tmpdir(), 'embedding-restart-test-'))
  const warn = vi.fn()
  const makeService = () => new LocalEmbeddingRetriever(async () => '/fixture.gguf',
    new EmbeddingVectorStore(async () => directory, warn))
  let service = makeService()
  try {
    await service.rank([chunk], 'test', undefined, 'notes')
    await service.close()
    service = makeService()
    const before = mocks.embed.mock.calls.length
    await service.rank([{ ...chunk, sourceChunkId: 'moved' }, { ...chunk, sourceChunkId: 'new', text: 'changed' }], 'test', undefined, 'notes')
    expect(mocks.embed.mock.calls.length - before).toBe(2) // query + changed input, moved input restored
    const saved = await readFile(join(directory, 'vectors.json'), 'utf8')
    mocks.embed.mockResolvedValueOnce({ vector: Array(1024).fill(1) }).mockRejectedValueOnce(new Error('native failure'))
    await expect(service.rank([{ ...chunk, text: 'another edit' }], 'test', undefined, 'notes')).rejects.toThrow('native failure')
    expect(await readFile(join(directory, 'vectors.json'), 'utf8')).toBe(saved)
    const controller = new AbortController()
    mocks.embed.mockImplementationOnce(async () => { controller.abort(); return { vector: Array(1024).fill(1) } })
    await expect(service.rank([chunk], 'test', controller.signal, 'notes')).rejects.toThrow()
    expect(await readFile(join(directory, 'vectors.json'), 'utf8')).toBe(saved)
    await service.rank([], 'test', undefined, 'notes')
    expect(JSON.parse(await readFile(join(directory, 'vectors.json'), 'utf8')).vectors).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }) }
})

it('recomputes corrupted disk data and still answers when saving fails', async () => {
  runtime()
  const directory = await mkdtemp(join(tmpdir(), 'embedding-failure-test-'))
  const warn = vi.fn()
  let accessCount = 0
  const service = new LocalEmbeddingRetriever(async () => '/fixture.gguf', new EmbeddingVectorStore(async () => {
    if (++accessCount > 1) throw new Error('disk unavailable')
    return directory
  }, warn))
  try {
    await writeFile(join(directory, 'vectors.json'), '{broken')
    expect((await service.rank([chunk], 'test'))![0].score).toBeCloseTo(1)
    expect(mocks.embed).toHaveBeenCalledTimes(2)
    await service.rank([chunk], 'test')
    expect(mocks.embed).toHaveBeenCalledTimes(3) // current memory remains usable
    expect(warn.mock.calls.map(call => call[0])).toEqual(['restore', 'save', 'save'])
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }) }
})
