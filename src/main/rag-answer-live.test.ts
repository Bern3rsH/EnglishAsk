import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { answerFromNotes } from './rag-answer-service'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd(),
  getPath: () => dirname(process.env.RAG_ANSWER_SETTINGS_PATH ?? '/missing/settings.json') } }))

it.skipIf(process.env.RAG_ANSWER_LIVE !== '1')('answers a synthetic comparison with the configured live provider', async () => {
  if (!process.env.RAG_ANSWER_SETTINGS_PATH) throw new Error('RAG_ANSWER_SETTINGS_PATH is required.')
  const directory = await mkdtemp(join(tmpdir(), 'englishask-rag-live-'))
  try {
    for (const filename of ['used-to.md', 'be-used-to.md', 'get-used-to.md', 'present-perfect.md']) {
      await writeFile(join(directory, filename), await readFile(
        new URL(`../../tests/fixtures/rag/notes/${filename}`, import.meta.url), 'utf8'))
    }
    const start = performance.now()
    const result = await answerFromNotes('根据笔记，used to 和 be used to 的含义有什么区别？', {
      notesDirectory: directory, signal: AbortSignal.timeout(85_000)
    })
    expect(result.status).toBe('answered')
    expect(result.generationCalled).toBe(true)
    expect(result.sources.map(source => source.noteId)).toContain('used-to.md')
    expect(result.sources.map(source => source.noteId)).toContain('be-used-to.md')
    expect(result.answer).toMatch(/过去/)
    expect(result.answer).toMatch(/习惯/)
    // 只输出隔离的合成样例回答与来源编号，不输出凭据或真实用户笔记。
    console.info('RAG synthetic live result', JSON.stringify({ provider: result.modelProvider, model: result.model,
      elapsedMs: Math.round(performance.now() - start), answer: result.answer,
      sources: result.sources.map(source => ({ sourceId: source.sourceId, noteId: source.noteId, quote: source.quote })) }))
    if (process.env.RAG_ANSWER_OUTPUT_PATH) {
      await writeFile(process.env.RAG_ANSWER_OUTPUT_PATH, JSON.stringify({ fixture: 'four synthetic Markdown Notes',
        generation: 'live', status: result.status, provider: result.modelProvider, model: result.model,
        answer: result.answer, sources: result.sources.map(source => ({ sourceId: source.sourceId,
          noteId: source.noteId, quote: source.quote })) }, null, 2) + '\n', { mode: 0o600 })
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 90_000)
