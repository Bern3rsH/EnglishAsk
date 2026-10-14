import type { Llama, LlamaModel, LlamaEmbeddingContext } from 'node-llama-cpp'
import { LOCAL_EMBEDDING_MODEL } from '../shared/embedding'
import { getEmbeddingModelManager } from './embedding-model'
import { EmbeddingVectorCache, MAX_INDEX_WINDOWS, windowVectorKey, type VectorIndex, type WindowVectors } from './embedding-vector-cache'
import { localEmbeddingVectorStore, type EmbeddingVectorStore } from './embedding-vector-store'

const RESERVED_SPECIAL_TOKENS = 8
const EMBEDDING_BATCH_SIZE = 512
const INPUT_TOKEN_LIMIT = LOCAL_EMBEDDING_MODEL.contextSize - RESERVED_SPECIAL_TOKENS
const IDLE_RELEASE_MS = 60_000
const QUERY_INSTRUCTION = 'Instruct: Given an English learning question, retrieve relevant passages from English study notes that answer the question.\nQuery: '
export type SemanticChunk = { sourceChunkId: string; title: string; text: string }
export const cosineSimilarity = (left: readonly number[], right: readonly number[]) => {
  if (left.length !== right.length || !left.length) throw new Error('向量维度无效。')
  let dot = 0, leftNorm = 0, rightNorm = 0
  for (let index = 0; index < left.length; index++) {
    if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) throw new Error('向量数值无效。')
    dot += left[index] * right[index]
    leftNorm += left[index] ** 2
    rightNorm += right[index] ** 2
  }
  if (!leftNorm || !rightNorm) throw new Error('空向量。')
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)))
}

// 串行使用一个 2K context；完整目录快照维护来源，实际输入维护可复用向量。
export class LocalEmbeddingRetriever {
  private llama?: Llama
  private model?: LlamaModel
  private context?: LlamaEmbeddingContext
  private queue: Promise<unknown> = Promise.resolve()
  private timer?: ReturnType<typeof setTimeout>
  private cache = new EmbeddingVectorCache()
  private closing = false
  private shutdownController = new AbortController()
  private restoredScopeId?: string
  constructor(private modelPath = async () => (await getEmbeddingModelManager()).verifiedPath(),
    private vectorStore?: EmbeddingVectorStore) {}
  // chunks 必须是当前目录的完整快照，不能传入筛选后的 top-k 候选。
  rank(chunks: SemanticChunk[], question: string, signal?: AbortSignal, directoryScopeId = 'standalone'): Promise<{ sourceChunkId: string; score: number }[] | undefined> {
    signal = signal ? AbortSignal.any([signal, this.shutdownController.signal]) : this.shutdownController.signal
    const operation = this.queue.then(async () => {
      signal?.throwIfAborted()
      if (this.closing) throw new Error('本地模型正在关闭。')
      clearTimeout(this.timer)
      try {
        if (this.restoredScopeId !== directoryScopeId) {
          await this.vectorStore?.restore(this.cache, directoryScopeId)
          this.restoredScopeId = directoryScopeId
          signal?.throwIfAborted()
        }
        if (!chunks.length) {
          this.cache.commit(directoryScopeId, new Map(), new Map())
          await this.vectorStore?.save(this.cache)
          signal?.throwIfAborted()
          await this.release()
          return []
        }
        const path = await this.modelPath()
        signal?.throwIfAborted()
        if (!path) { await this.release(); return undefined }
        if (!this.context) {
          const { getLlama, LlamaLogLevel } = await import('node-llama-cpp')
          this.llama = await getLlama({ gpu: 'auto', build: 'never', skipDownload: true, progressLogs: false, logLevel: LlamaLogLevel.error })
          this.model = await this.llama.loadModel({ modelPath: path, gpuLayers: 'max', loadSignal: signal })
          this.context = await this.model.createEmbeddingContext({ contextSize: LOCAL_EMBEDDING_MODEL.contextSize,
            batchSize: EMBEDDING_BATCH_SIZE, createSignal: signal })
        }
        const model = this.model!, context = this.context!
        const queryTokens = model.tokenize(QUERY_INSTRUCTION + question)
        if (queryTokens.length > INPUT_TOKEN_LIMIT) throw new Error('检索问题超过本地模型长度限制。')
        const queryVector = (await context.getEmbeddingFor(queryTokens)).vector
        signal?.throwIfAborted()
        let windowCount = 0
        const currentIndex: VectorIndex = new Map()
        const newVectors: WindowVectors = new Map()
        const ranked: { sourceChunkId: string; score: number }[] = []
        for (const chunk of chunks) {
          signal?.throwIfAborted()
          if (currentIndex.has(chunk.sourceChunkId)) throw new Error('笔记片段身份重复。')
          const tokens = model.tokenize(`${chunk.title}\n${chunk.text}`)
          const vectorKeys: string[] = []
          let score = -1
          for (let offset = 0; offset < tokens.length; offset += INPUT_TOKEN_LIMIT) {
            if (++windowCount > MAX_INDEX_WINDOWS) throw new Error('笔记超过本次语义检索容量。')
            const window = tokens.slice(offset, offset + INPUT_TOKEN_LIMIT)
            const key = windowVectorKey(window)
            let vector = newVectors.get(key) ?? this.cache.get(directoryScopeId, key)
            if (!vector) {
              vector = (await context.getEmbeddingFor(window)).vector
              signal?.throwIfAborted()
              if (vector.length !== LOCAL_EMBEDDING_MODEL.dimensions) throw new Error('模型向量维度不匹配。')
              newVectors.set(key, vector)
            }
            vectorKeys.push(key)
            score = Math.max(score, cosineSimilarity(queryVector, vector))
          }
          currentIndex.set(chunk.sourceChunkId, vectorKeys)
          ranked.push({ sourceChunkId: chunk.sourceChunkId, score })
        }
        signal?.throwIfAborted()
        this.cache.commit(directoryScopeId, currentIndex, newVectors)
        await this.vectorStore?.save(this.cache)
        signal?.throwIfAborted()
        return ranked.sort((left, right) => right.score - left.score)
      } catch (error) {
        await this.release()
        throw error
      } finally {
        if (!this.closing && this.context) {
          this.timer = setTimeout(() => { this.queue = this.queue.then(() => this.release()).catch(() => {}) }, IDLE_RELEASE_MS)
          this.timer.unref()
        }
      }
    })
    this.queue = operation.catch(() => {})
    return operation
  }
  private async release() {
    clearTimeout(this.timer)
    const context = this.context, model = this.model, llama = this.llama
    this.context = undefined; this.model = undefined; this.llama = undefined
    try { await context?.dispose() } finally {
      try { await model?.dispose() } finally { await llama?.dispose() }
    }
  }
  async close() {
    this.closing = true
    this.shutdownController.abort()
    clearTimeout(this.timer)
    await this.queue
    await this.release()
    this.cache.clear()
  }
}
export const localEmbeddingRetriever = new LocalEmbeddingRetriever(undefined, localEmbeddingVectorStore)
