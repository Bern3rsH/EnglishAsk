import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { answerFromNotes } from './rag-answer-service'
import { retrieveNotes } from './rag-note-retrieval'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd(),
  getPath: () => dirname(process.env.RAG_ANSWER_SETTINGS_PATH ?? '/missing/settings.json') } }))

const QUESTION = 'draw attention to的例句'
const RUN_COUNT = 3
const NOTE = `# draw attention to 的用法
## 结构
draw attention to + 名词：引起对某事物的注意。
draw attention to + 动名词：引起对某行为的注意。
draw attention to + the fact that 从句：提醒注意某个事实。
draw someone's attention to + 名词：让某人注意到某事。
## 含义
draw attention to 表示「引起对……的注意」「提醒人们注意……」。被关注的对象要放在介词 to 后面。
## 例句
1. The article draws attention to the dangers of texting while driving.
   这篇文章引起了人们对开车时发短信这一危险行为的关注。
2. I'd like to draw your attention to the figures in the second column.
   我想请大家注意第二栏里的数字。
3. She drew attention to the fact that the deadline had been moved.
   她提醒大家注意截止日期已经更改这一事实。
4. He often draws attention to himself in meetings.
   他经常在会议上刻意引人注目。
`

it.skipIf(process.env.RAG_EXAMPLE_SCOPE_LIVE !== '1')('keeps live example-only answers within scope despite retrieving meaning and structure', async () => {
  if (!process.env.RAG_ANSWER_SETTINGS_PATH) throw new Error('RAG_ANSWER_SETTINGS_PATH is required.')
  const directory = await mkdtemp(join(tmpdir(), 'englishask-rag-scope-'))
  const runs: unknown[] = []
  try {
    await writeFile(join(directory, 'draw-attention-to.md'), NOTE)
    const retrieved = await retrieveNotes(QUESTION, { notesDirectory: directory })
    const titles = retrieved.matches.map(chunk => chunk.title)
    expect(titles).toHaveLength(3)
    for (const section of ['结构', '含义', '例句']) expect(titles.some(title => title.endsWith(section))).toBe(true)
    for (let attempt = 1; attempt <= RUN_COUNT; attempt++) {
      const start = performance.now()
      const result = await answerFromNotes(QUESTION, { notesDirectory: directory, signal: AbortSignal.timeout(85_000) })
      const report = { attempt, provider: result.modelProvider, model: result.model,
        elapsedMs: Math.round(performance.now() - start), answer: result.answer,
        sources: result.sources.map(source => ({ sourceId: source.sourceId, title: source.title, quote: source.quote })) }
      runs.push(report)
      // Only synthetic examples and result metadata; no credentials or real user Notes.
      console.info('RAG example scope live result', JSON.stringify(report))
      expect(result.status).toBe('answered')
      expect(result.generationCalled).toBe(true)
      expect(result.sources.length).toBeGreaterThan(0)
      expect(result.sources.every(source => source.title.endsWith('例句'))).toBe(true)
      expect(result.answer).not.toMatch(/含义|结构|动名词|介词|表示[「“"']|\+\s*(?:名词|the fact)/)
      for (const sentence of [
        'The article draws attention to the dangers of texting while driving.',
        "I'd like to draw your attention to the figures in the second column.",
        'She drew attention to the fact that the deadline had been moved.',
        'He often draws attention to himself in meetings.'
      ]) expect(result.answer).toContain(sentence)
    }
  } finally {
    if (process.env.RAG_EXAMPLE_SCOPE_OUTPUT_PATH) await writeFile(process.env.RAG_EXAMPLE_SCOPE_OUTPUT_PATH,
      JSON.stringify({ question: QUESTION, fixture: 'synthetic meaning, structure and four bilingual examples',
        generation: 'live', runs }, null, 2) + '\n', { mode: 0o600 })
    await rm(directory, { recursive: true, force: true })
  }
}, 270_000)
