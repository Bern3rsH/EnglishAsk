export interface LexicalChunk {
  source: string
  title: string
  text: string
}
export interface RankedChunk {
  id: string
  tokens: string[]
  score: number
  chunkLength: number
  averageChunkLength: number
  matchedTermCount: number
  termScores: { term: string; documentFrequency: number; termFrequency: number; idf: number; contribution: number }[]
}
export function collectNoteTopics(chunks: LexicalChunk[]): string[]
export function tokenizeChunkWithTopics(text: string, topics: string[]): string[]
export function extractQueryTermsWithTopics(question: string, topics: string[]): string[]
export function retrieveChunksWithPhraseBm25<T extends LexicalChunk>(chunks: T[], question: string, topK?: number): {
  topics: string[]
  queryTerms: string[]
  candidateCount: number
  matches: (T & RankedChunk)[]
  context: string
}
