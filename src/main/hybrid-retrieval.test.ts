import { expect, it } from 'vitest'
import { fuseRetrievalRanks } from './hybrid-retrieval'
const chunks = ['a','b','c'].map(sourceChunkId => ({ sourceChunkId, text: sourceChunkId }))
const lexical = [{ ...chunks[1], id: 'b', tokens: [], score: 9000, chunkLength: 1, averageChunkLength: 1, matchedTermCount: 1, termScores: [] }]
it('fuses ranks, preserves source text, deduplicates and takes top-k', () => {
  const semantic = [{ sourceChunkId: 'a', score: .9 }, { sourceChunkId: 'b', score: .8 }, { sourceChunkId: 'c', score: .7 }]
  const result = fuseRetrievalRanks(chunks, lexical, semantic, 2)
  expect(result.map(chunk => chunk.sourceChunkId)).toEqual(['b','a'])
  expect(result[0].score).toBeCloseTo(1/61+1/62)
  expect(result[0].text).toBe('b')
  expect(fuseRetrievalRanks(chunks, [], [], 3)).toEqual([])
})
