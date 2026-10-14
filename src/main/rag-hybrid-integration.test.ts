import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { retrieveNotes } from './rag-note-retrieval'
const rank = vi.hoisted(() => vi.fn())
vi.mock('./local-embedding', () => ({ localEmbeddingRetriever: { rank } }))
const directories: string[] = []
afterEach(async () => { rank.mockReset(); await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))) })
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'rag-hybrid-test-')); directories.push(path)
  await writeFile(join(path, 'Attention.md'), '# draw attention to\n## 例句\nThe article draws attention to dangers.')
  return path
}
it('semantic paraphrases retrieve original evidence even with no lexical match', async () => {
  const notesDirectory = await directory()
  rank.mockImplementation(async chunks => chunks.map((chunk: { sourceChunkId: string }) => ({ sourceChunkId: chunk.sourceChunkId, score: .8 })))
  const result = await retrieveNotes('提醒别人留意', { notesDirectory })
  expect(result.retrievalDiagnostic.mode).toBe('hybrid')
  expect(result.matches[0]).toMatchObject({ source: 'Attention.md', text: 'The article draws attention to dangers.' })
  expect(result.matches[0].sourceChunkId).toMatch(/^[a-f0-9]{64}$/)
  expect(result.context).toContain('The article')
})
it('native failure retains lexical results with a visible diagnostic', async () => {
  const notesDirectory = await directory(); rank.mockRejectedValue(new Error('native failure'))
  const result = await retrieveNotes('draw attention to', { notesDirectory })
  expect(result.matches).toHaveLength(1)
  expect(result.retrievalDiagnostic).toMatchObject({ mode: 'bm25', notice: expect.stringContaining('关键词检索') })
})
it('disabled or missing models retain lexical retrieval and cancellation never falls back', async () => {
  const notesDirectory = await directory(); rank.mockResolvedValue(undefined)
  expect((await retrieveNotes('draw attention to', { notesDirectory })).retrievalDiagnostic.mode).toBe('bm25')
  const controller = new AbortController()
  rank.mockImplementation(async () => { controller.abort(); throw controller.signal.reason })
  await expect(retrieveNotes('draw attention to', { notesDirectory, signal: controller.signal })).rejects.toThrow()
})

it('passes an empty complete directory snapshot to remove all semantic references', async () => {
  const notesDirectory = await mkdtemp(join(tmpdir(), 'rag-empty-index-test-')); directories.push(notesDirectory)
  rank.mockResolvedValue([])
  const result = await retrieveNotes('test', { notesDirectory })
  expect(rank).toHaveBeenCalledWith([], 'test', undefined, result.directoryScopeId)
  expect(result.matches).toEqual([])
  expect(result.retrievalDiagnostic.mode).toBe('bm25')
})
