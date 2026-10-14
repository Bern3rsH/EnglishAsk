export interface DirectoryChunk {
  source: string
  title: string
  text: string
  sourcePath: string
  sourceRevision: string
  sourceChunkId: string
  sectionIndex: number
}
export interface DirectoryLimits {
  maxEntries: number
  maxNotes: number
  maxFileBytes: number
  maxTotalBytes: number
  maxChunks: number
}
export const DIRECTORY_LIMITS: Readonly<DirectoryLimits>
export function loadDirectoryChunks(directoryPath: string, limits?: DirectoryLimits, options?: {
  signal?: AbortSignal
  splitNote?: (markdown: string, filename: string) => { source: string; title: string; text: string }[]
}): Promise<{
  directory: string
  noteCount: number
  totalBytes: number
  notes: { source: string; sourcePath: string; sourceRevision: string; markdown: string }[]
  chunks: DirectoryChunk[]
}>
