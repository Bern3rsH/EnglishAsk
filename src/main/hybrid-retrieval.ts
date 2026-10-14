import type { RankedChunk } from '../../scripts/rag-phrase-bm25.mjs'
const RRF_RANK_CONSTANT = 60
const CANDIDATE_POOL_SIZE = 20
// 分数的量纲不同，融合排名而非直接相加 BM25 与 cosine 分数。
export function fuseRetrievalRanks<T extends { sourceChunkId: string }>(chunks: T[], lexical: (T & RankedChunk)[],
  semantic: { sourceChunkId: string; score: number }[], topK: number): (T & RankedChunk)[] {
  const scores = new Map<string, number>()
  const poolSize = Math.max(CANDIDATE_POOL_SIZE, topK)
  for (const ranking of [lexical, semantic]) {
    ranking.slice(0, poolSize).forEach((chunk, index) => {
      scores.set(chunk.sourceChunkId, (scores.get(chunk.sourceChunkId) ?? 0) + 1 / (RRF_RANK_CONSTANT + index + 1))
    })
  }
  const lexicalById = new Map(lexical.map(chunk => [chunk.sourceChunkId, chunk]))
  return chunks.filter(chunk => scores.has(chunk.sourceChunkId)).map((chunk, index) => ({
    id: `chunk-${index + 1}`, tokens: [], chunkLength: 0, averageChunkLength: 0, matchedTermCount: 0, termScores: [],
    ...chunk, ...lexicalById.get(chunk.sourceChunkId), score: scores.get(chunk.sourceChunkId)!
  })).sort((left, right) => right.score - left.score).slice(0, topK)
}
