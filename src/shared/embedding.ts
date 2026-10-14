export const EMBEDDING_CHANNELS = {
  status: 'english-ask:embedding-status', download: 'english-ask:embedding-download',
  cancel: 'english-ask:embedding-cancel', enabled: 'english-ask:embedding-enabled'
} as const
export const LOCAL_EMBEDDING_MODEL = {
  name: 'Qwen3 Embedding 0.6B', filename: 'qwen3-embedding-0.6b-q8_0.gguf',
  bytes: 639_150_592,
  sha256: '06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439',
  contextSize: 2048, dimensions: 1024
} as const
export interface EmbeddingStatus {
  status: 'missing' | 'checking' | 'downloading' | 'ready' | 'error'
  downloadedBytes: number
  totalBytes: number
  enabled: boolean
  error?: string
}
export type EmbeddingResult = { ok: true; data: EmbeddingStatus } | { ok: false; error: string }
export interface EmbeddingBridge {
  getEmbeddingStatus: () => Promise<EmbeddingResult>
  downloadEmbeddingModel: () => Promise<EmbeddingResult>
  cancelEmbeddingDownload: () => Promise<EmbeddingResult>
  setEmbeddingEnabled: (enabled: boolean) => Promise<EmbeddingResult>
}
export interface RetrievalDiagnostic {
  mode: 'bm25' | 'hybrid'
  notice?: string
}
