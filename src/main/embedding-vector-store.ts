import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { EmbeddingVectorCache } from './embedding-vector-cache'

export const MAX_CACHE_BYTES = 16 * 1024 * 1024
const CACHE_FILENAME = 'vectors.json'
type CacheWarning = (operation: 'restore' | 'save', reason: string) => void
const defaultWarning: CacheWarning = (operation, reason) => console.warn(`[embedding-cache] ${operation}: ${reason}`)
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

// A single app-owned snapshot, never a path supplied by a note or renderer.
export class EmbeddingVectorStore {
  private lastSaved?: string
  constructor(private directory: () => Promise<string>, private warn: CacheWarning = defaultWarning) {}

  private async paths() {
    const directory = await this.directory()
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe cache directory.')
    return { directory, target: join(directory, CACHE_FILENAME) }
  }

  async restore(cache: EmbeddingVectorCache, directoryScopeId: string) {
    this.lastSaved = undefined
    try {
      const { target } = await this.paths()
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      let content: string
      try {
        const info = await handle.stat()
        if (!info.isFile() || info.size > MAX_CACHE_BYTES) throw new Error('Invalid cache file size or type.')
        // Read at most the bound + one byte, even if another process grows the file.
        const buffer = Buffer.alloc(MAX_CACHE_BYTES + 1)
        let bytes = 0
        while (bytes < buffer.length) {
          const result = await handle.read(buffer, bytes, buffer.length - bytes, null)
          if (!result.bytesRead) break
          bytes += result.bytesRead
        }
        if (bytes > MAX_CACHE_BYTES) throw new Error('Cache exceeds size limit.')
        content = buffer.subarray(0, bytes).toString('utf8')
      } finally { await handle.close() }
      cache.restore(directoryScopeId, JSON.parse(content))
      this.lastSaved = JSON.stringify(cache.snapshot())
    } catch (error) {
      if (!missing(error)) this.warn('restore', 'Cache unavailable or invalid; recomputing when needed.')
    }
  }

  async save(cache: EmbeddingVectorCache) {
    let temporary: string | undefined
    try {
      const snapshot = cache.snapshot()
      if (!snapshot) return
      const content = JSON.stringify(snapshot)
      if (content === this.lastSaved) return
      if (Buffer.byteLength(content) > MAX_CACHE_BYTES) throw new Error('Cache exceeds size limit.')
      const { directory, target } = await this.paths()
      temporary = join(directory, `vectors-${randomUUID()}.tmp`)
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(content); await handle.sync() } finally { await handle.close() }
      await rename(temporary, target)
      this.lastSaved = content
    } catch {
      this.warn('save', 'Cache could not be saved; current memory results remain available.')
    } finally {
      if (temporary) await unlink(temporary).catch(() => {})
    }
  }
}

export const localEmbeddingVectorStore = new EmbeddingVectorStore(async () => {
  const { app } = await import('electron')
  return join(app.getPath('userData'), 'embedding-cache')
})
