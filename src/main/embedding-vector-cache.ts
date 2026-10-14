import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { LOCAL_EMBEDDING_MODEL } from '../shared/embedding'

const WINDOW_PROCESSING_VERSION = 1
const CACHE_FORMAT_VERSION = 1
export const MAX_INDEX_WINDOWS = 512
export type VectorIndex = Map<string, readonly string[]>
export type WindowVectors = Map<string, readonly number[]>
export const validWindowVector = (vector: unknown): vector is number[] => {
  if (!Array.isArray(vector) || vector.length !== LOCAL_EMBEDDING_MODEL.dimensions || !vector.every(Number.isFinite)) return false
  const squaredNorm = vector.reduce((sum, value) => sum + value ** 2, 0)
  return Number.isFinite(squaredNorm) && squaredNorm > 0
}
export type VectorSnapshot = {
  formatVersion: number; modelSha256: string; processingVersion: number; contextSize: number
  directoryScopeId: string; vectors: [string, readonly number[]][]
}

// Tokens are the actual document input; source identity and location are independent.
export const windowVectorKey = (tokens: readonly number[]) => createHash('sha256').update(JSON.stringify([
  LOCAL_EMBEDDING_MODEL.sha256, WINDOW_PROCESSING_VERSION, LOCAL_EMBEDDING_MODEL.contextSize, tokens
])).digest('hex')

export class EmbeddingVectorCache {
  private directoryScopeId?: string
  private index: VectorIndex = new Map()
  private vectors: WindowVectors = new Map()

  get(directoryScopeId: string, vectorKey: string) {
    return this.directoryScopeId === directoryScopeId ? this.vectors.get(vectorKey) : undefined
  }

  snapshot(): VectorSnapshot | undefined {
    if (this.directoryScopeId === undefined) return undefined
    return { formatVersion: CACHE_FORMAT_VERSION, modelSha256: LOCAL_EMBEDDING_MODEL.sha256,
      processingVersion: WINDOW_PROCESSING_VERSION, contextSize: LOCAL_EMBEDDING_MODEL.contextSize,
      directoryScopeId: this.directoryScopeId,
      vectors: [...this.vectors].sort(([left], [right]) => left.localeCompare(right)).map(([key, vector]) => [key, [...vector]]) }
  }

  restore(directoryScopeId: string, saved: unknown) {
    assert(saved && typeof saved === 'object', 'Invalid vector cache object.')
    const snapshot = saved as VectorSnapshot
    assert(snapshot.formatVersion === CACHE_FORMAT_VERSION && snapshot.modelSha256 === LOCAL_EMBEDDING_MODEL.sha256
      && snapshot.processingVersion === WINDOW_PROCESSING_VERSION && snapshot.contextSize === LOCAL_EMBEDDING_MODEL.contextSize,
    'Incompatible vector cache configuration.')
    assert(snapshot.directoryScopeId === directoryScopeId, 'Vector cache directory mismatch.')
    assert(Array.isArray(snapshot.vectors) && snapshot.vectors.length <= MAX_INDEX_WINDOWS, 'Invalid vector cache count.')
    const restoredVectors: WindowVectors = new Map()
    for (const entry of snapshot.vectors) {
      assert(Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string'
        && /^[a-f0-9]{64}$/.test(entry[0]) && !restoredVectors.has(entry[0]) && validWindowVector(entry[1]),
      'Invalid vector cache entry.')
      restoredVectors.set(entry[0], [...entry[1]])
    }
    // Publish only after every entry passes. Sources are rebuilt from current notes.
    this.directoryScopeId = directoryScopeId
    this.index = new Map()
    this.vectors = restoredVectors
  }

  // Called only after the whole directory snapshot has successfully been processed.
  // Cancellation/read/native failures never publish a partial replacement index.
  commit(directoryScopeId: string, currentIndex: VectorIndex, newVectors: WindowVectors) {
    const usedVectorKeys = new Set([...currentIndex.values()].flat())
    assert(usedVectorKeys.size <= MAX_INDEX_WINDOWS, 'Vector index exceeds the cache limit.')
    const nextVectors: WindowVectors = new Map()
    for (const vectorKey of usedVectorKeys) {
      const vector = newVectors.get(vectorKey) ?? this.get(directoryScopeId, vectorKey)
      assert(validWindowVector(vector),
        'Vector index has a missing or invalid vector.')
      nextVectors.set(vectorKey, vector)
    }
    // Unreferenced old vectors are absent from nextVectors, including shared inputs
    // only when their last current chunk reference has disappeared.
    this.directoryScopeId = directoryScopeId
    this.index = new Map([...currentIndex].map(([chunkId, vectorKeys]) => [chunkId, [...vectorKeys]]))
    this.vectors = nextVectors
  }

  clear() {
    this.directoryScopeId = undefined
    this.index.clear()
    this.vectors.clear()
  }
}
