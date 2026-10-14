import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { askEnglish } from './ai-service'

const fixture = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd(),
  getPath: () => dirname(process.env.RAG_ANSWER_SETTINGS_PATH ?? '/missing/settings.json') } }))
vi.mock('./settings', async importOriginal => ({ ...await importOriginal<typeof import('./settings')>(),
  getConfiguredNoteStorageDirectory: async () => fixture.directory }))

it.skipIf(process.env.RAG_ROUTING_LIVE !== '1')('answers an automatic Notes request and retains no-evidence behavior with live models', async () => {
  if (!process.env.RAG_ANSWER_SETTINGS_PATH) throw new Error('RAG_ANSWER_SETTINGS_PATH is required.')
  fixture.directory = await mkdtemp(join(tmpdir(), 'englishask-auto-notes-live-'))
  try {
    await writeFile(join(fixture.directory, 'draw-attention-to.md'), `# draw attention to
## 含义
draw attention to 表示引起对某事的注意。
## 结构
draw attention to + 名词。
## 例句
The article draws attention to the dangers of texting while driving.
这篇文章引起了人们对开车时发短信这一危险行为的关注。
`)
    const result = await askEnglish({ requestId: 'auto-live-note', answerMode: 'auto',
      question: '我的笔记里draw attention to的例句', history: [] })
    expect(result.noteAnswer?.status).toBe('answered')
    expect(result.noteAnswer?.generationCalled).toBe(true)
    expect(result.answer).toContain('The article draws attention to the dangers of texting while driving.')
    expect(result.answer).not.toMatch(/含义|结构|\+\s*名词/)
    expect(result.noteAnswer?.sources.every(source => source.title.endsWith('例句'))).toBe(true)
    const missing = await askEnglish({ requestId: 'auto-live-missing', answerMode: 'auto',
      question: '我的笔记里photosynthesis的定义是什么？', history: [] })
    expect(missing.noteAnswer?.status).toBe('no_evidence')
    expect(missing.noteAnswer?.generationCalled).toBe(false)
    if (process.env.RAG_AUTO_ANSWER_OUTPUT_PATH) await writeFile(process.env.RAG_AUTO_ANSWER_OUTPUT_PATH,
      JSON.stringify({ generation: 'live', fixture: 'isolated synthetic Note',
        answer: result.answer, status: result.noteAnswer?.status,
        provider: result.noteAnswer?.modelProvider, model: result.model,
        sourceTitles: result.noteAnswer?.sources.map(source => source.title),
        missing: { answer: missing.answer, status: missing.noteAnswer?.status,
          generationCalled: missing.noteAnswer?.generationCalled } }, null, 2) + '\n', { mode: 0o600 })
  } finally { await rm(fixture.directory, { recursive: true, force: true }) }
}, 200_000)
