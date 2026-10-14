import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { LOCAL_EMBEDDING_MODEL, type EmbeddingStatus } from '../shared/embedding'

const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000
type Artifact = Pick<typeof LOCAL_EMBEDDING_MODEL, 'filename' | 'bytes' | 'sha256'> | {
  filename: string; bytes: number; sha256: string
}
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
const modelUrl = `https://registry.ollama.ai/v2/library/qwen3-embedding/blobs/sha256:${LOCAL_EMBEDDING_MODEL.sha256}`

// 主进程拥有路径和下载地址；renderer 只能启动/取消固定模型下载。
export class EmbeddingModelManager {
  private state: EmbeddingStatus
  private initialized = false
  private initialization?: Promise<void>
  private signature?: string
  private job?: Promise<void>
  private controller?: AbortController
  readonly modelPath: string
  constructor(readonly directory: string, private options: {
    artifact?: Artifact
    fetchModel?: (signal: AbortSignal) => Promise<Response>
  } = {}) {
    this.modelPath = join(directory, this.artifact.filename)
    this.state = { status: 'missing', downloadedBytes: 0, totalBytes: this.artifact.bytes, enabled: true }
  }
  private get artifact(): Artifact { return this.options.artifact ?? LOCAL_EMBEDDING_MODEL }
  private async ensureDirectory() {
    await mkdir(this.directory, { recursive: true })
    if (!(await lstat(this.directory)).isDirectory()) throw new Error('模型目录不可用。')
  }
  private async regularFile(path: string) {
    const metadata = await lstat(path)
    if (!metadata.isFile()) throw new Error('模型文件不可用，请重新下载。')
    return metadata
  }
  private async initialize() {
    if (this.initialized) return
    if (this.initialization) return this.initialization
    this.initialization = (async () => {
      await this.ensureDirectory()
      try {
        const path = join(this.directory, 'enabled.json')
        await this.regularFile(path)
        const enabled: unknown = JSON.parse(await readFile(path, 'utf8'))
        this.state.enabled = enabled === true
      } catch (error) { if (!isMissing(error)) this.state.enabled = false }
      this.initialized = true
    })().finally(() => { this.initialization = undefined })
    return this.initialization
  }
  async getStatus(): Promise<EmbeddingStatus> {
    await this.initialize()
    if (this.job || this.state.status === 'checking') return { ...this.state }
    try {
      const metadata = await this.regularFile(this.modelPath)
      const signature = `${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}:${metadata.ino}`
      if (this.signature !== signature) {
        this.state.status = 'checking'
        if (metadata.size !== this.artifact.bytes) throw new Error('模型文件不完整，请重新下载。')
        const hash = createHash('sha256')
        for await (const block of createReadStream(this.modelPath)) hash.update(block)
        if (hash.digest('hex') !== this.artifact.sha256) throw new Error('模型校验失败，请重新下载。')
        this.signature = signature
      }
      this.state = { ...this.state, status: 'ready', downloadedBytes: this.artifact.bytes, error: undefined }
    } catch (error) {
      this.signature = undefined
      this.state = { ...this.state, status: isMissing(error) ? (this.state.status === 'error' ? 'error' : 'missing') : 'error', downloadedBytes: 0,
        error: isMissing(error) ? this.state.error : '模型校验失败或文件不可用，请重新下载。' }
    }
    return { ...this.state }
  }
  async verifiedPath(): Promise<string | undefined> {
    const state = await this.getStatus()
    if (state.status === 'error' && state.enabled) throw new Error('本地模型未通过校验。')
    return state.status === 'ready' && state.enabled ? this.modelPath : undefined
  }
  async setEnabled(enabled: unknown): Promise<EmbeddingStatus> {
    if (typeof enabled !== 'boolean') throw new Error('语义检索开关无效。')
    await this.initialize()
    const target = join(this.directory, 'enabled.json')
    try { await this.regularFile(target) } catch (error) { if (!isMissing(error)) throw error }
    const temporary = join(this.directory, `enabled-${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, JSON.stringify(enabled), { flag: 'wx', mode: 0o600 })
      await rename(temporary, target)
    } finally { await unlink(temporary).catch(() => {}) }
    this.state.enabled = enabled
    return this.getStatus()
  }
  async startDownload(): Promise<EmbeddingStatus> {
    const current = await this.getStatus()
    if (current.status === 'ready' || this.job) return current
    this.controller = new AbortController()
    const controller = this.controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)])
    this.state = { ...this.state, status: 'downloading', downloadedBytes: 0, error: undefined }
    this.job = this.download(signal).catch(() => {
      this.state = { ...this.state, status: controller.signal.aborted ? 'missing' : 'error',
        downloadedBytes: 0, error: controller.signal.aborted ? undefined : '模型下载失败，请检查网络、磁盘空间后重试。' }
    }).finally(() => { this.job = undefined; this.controller = undefined })
    return { ...this.state }
  }
  async cancelDownload(): Promise<EmbeddingStatus> {
    this.controller?.abort()
    await this.job
    return this.getStatus()
  }
  private async download(signal: AbortSignal) {
    const temporary = join(this.directory, `${this.artifact.filename}-${randomUUID()}.part`)
    try {
      const response = this.options.fetchModel ? await this.options.fetchModel(signal)
        : await (await import('electron')).net.fetch(modelUrl, { signal, credentials: 'omit' })
      if (!response.ok || !response.body) throw new Error('模型下载失败。')
      const length = response.headers.get('content-length')
      if (length !== null && Number(length) !== this.artifact.bytes) throw new Error('模型下载大小无效。')
      const hash = createHash('sha256')
      let bytes = 0
      const progress = new Transform({ transform: (block: Buffer, _encoding, callback) => {
        bytes += block.length
        if (bytes > this.artifact.bytes) return callback(new Error('模型超过大小限制。'))
        hash.update(block)
        this.state.downloadedBytes = bytes
        callback(null, block)
      } })
      await pipeline(Readable.fromWeb(response.body as never), progress,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal })
      signal.throwIfAborted()
      if (bytes !== this.artifact.bytes || hash.digest('hex') !== this.artifact.sha256) throw new Error('模型校验失败。')
      try { await this.regularFile(this.modelPath) } catch (error) { if (!isMissing(error)) throw error }
      await rename(temporary, this.modelPath)
      this.signature = undefined
      this.state.status = 'ready'
      await this.setEnabled(true)
    } finally { await unlink(temporary).catch(() => {}) }
  }
}

let managerPromise: Promise<EmbeddingModelManager> | undefined
export function getEmbeddingModelManager(): Promise<EmbeddingModelManager> {
  managerPromise ??= import('electron').then(({ app }) =>
    new EmbeddingModelManager(join(app.getPath('userData'), 'embedding-models'))
  ).catch(error => { managerPromise = undefined; throw error })
  return managerPromise
}
