import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { EmbeddingModelManager, getEmbeddingModelManager } from './embedding-model'
vi.mock('electron', () => ({ app: { getPath: () => '/unused-test-directory' } }))
const directories: string[] = []
const bytes = Buffer.from('a small verified model fixture')
const artifact = { filename: 'model.gguf', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
async function setup(fetchModel = async (_signal: AbortSignal) => new Response(bytes)) {
  const directory = await mkdtemp(join(tmpdir(), 'embedding-model-test-')); directories.push(directory)
  return new EmbeddingModelManager(directory, { artifact, fetchModel })
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })
async function settled(manager: EmbeddingModelManager) {
  await vi.waitFor(async () => { expect((await manager.getStatus()).status).not.toBe('downloading') })
  return manager.getStatus()
}
it('downloads atomically, verifies digest, persists enablement and revalidates after restart', async () => {
  const manager = await setup()
  expect((await manager.getStatus()).status).toBe('missing')
  expect(await manager.verifiedPath()).toBeUndefined()
  expect((await manager.startDownload()).status).toBe('downloading')
  expect((await settled(manager)).status).toBe('ready')
  expect(await readFile(manager.modelPath)).toEqual(bytes)
  expect(await manager.verifiedPath()).toBe(manager.modelPath)
  await manager.setEnabled(false)
  expect(await manager.verifiedPath()).toBeUndefined()
  const restart = new EmbeddingModelManager(manager.directory, { artifact })
  expect(await restart.getStatus()).toMatchObject({ status: 'ready', enabled: false })
  await writeFile(manager.modelPath, Buffer.alloc(bytes.length))
  expect((await restart.getStatus()).status).toBe('error')
  expect((await readdir(manager.directory)).some(name => name.endsWith('.part'))).toBe(false)
})
it.each([new Response(Buffer.alloc(bytes.length)), new Response('short'), new Response(bytes, { status: 503 }),
  new Response(bytes, { headers: { 'content-length': '1' } })])('rejects corrupted, short and failed downloads', async response => {
  const manager = await setup(async () => response)
  await manager.startDownload()
  expect((await settled(manager)).status).toBe('error')
  expect((await manager.getStatus()).error).toContain('下载失败')
  expect(await readdir(manager.directory)).toEqual([])
})
it('shares one download, cancels cleanly and can retry', async () => {
  let calls = 0
  const manager = await setup(async signal => {
    calls++
    if (calls > 1) return new Response(bytes)
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, 2))
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
    } }))
  })
  await Promise.all([manager.startDownload(), manager.startDownload()])
  expect(calls).toBe(1)
  await manager.cancelDownload()
  expect((await manager.getStatus()).status).toBe('missing')
  expect(await readdir(manager.directory)).toEqual([])
  await manager.startDownload()
  expect((await settled(manager)).status).toBe('ready')
})
it('rejects model symlinks and invalid enablement requests', async () => {
  const manager = await setup()
  const target = join(manager.directory, 'other'); await writeFile(target, bytes)
  await symlink(target, manager.modelPath)
  expect((await manager.getStatus()).status).toBe('error')
  await expect(manager.setEnabled('true')).rejects.toThrow('开关无效')
})

it('shares the same app manager when first IPC operations arrive concurrently', async () => {
  const [first, second] = await Promise.all([getEmbeddingModelManager(), getEmbeddingModelManager()])
  expect(first).toBe(second)
})
