import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, it, vi } from 'vitest'
import { decideNotesWithJev } from './jev-note-routing'
import { getStoredJevConfiguration } from './settings'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd(),
  getPath: () => dirname(process.env.RAG_ANSWER_SETTINGS_PATH ?? '/missing/settings.json') } }))

// Explicit diagnostic only: does not enable Jev or write application settings.
it.skipIf(process.env.JEV_NOTES_LIVE !== '1')('diagnoses saved Jev credentials on synthetic Notes decisions', async () => {
  if (!process.env.RAG_ANSWER_SETTINGS_PATH) throw new Error('RAG_ANSWER_SETTINGS_PATH is required.')
  const configuration = await getStoredJevConfiguration()
  if (!configuration.apiKey) throw new Error('Dedicated Jev key required.')
  const history = [
    { id: '1', role: 'user' as const, content: '根据我的笔记解释 draw attention to。', createdAt: '2026-10-11' },
    { id: '2', role: 'assistant' as const, content: '笔记中 draw attention to 表示引起注意。[S1]', createdAt: '2026-10-11' }
  ]
  const cases = [
    { question: 'draw attention to的例句', route: 'standard', queryMode: 'direct', history: [] },
    { question: '我的笔记里draw attention to的例句', route: 'notes', queryMode: 'direct', history: [] },
    { question: '它的例句呢？', route: 'notes', queryMode: 'contextual', history },
    { question: '不用我的笔记，解释 present perfect。', route: 'standard', queryMode: 'direct', history },
    { question: '翻译这句话：I take notes every day.', route: 'standard', queryMode: 'direct', history: [] }
  ]
  const results = []
  for (const entry of cases) {
    try {
      const decision = await decideNotesWithJev(entry, { channel: configuration.channel, apiKey: configuration.apiKey,
        ...(configuration.accountId ? { accountId: configuration.accountId } : {}) })
      results.push({ question: entry.question, expectedRoute: entry.route, expectedQueryMode: entry.queryMode,
        accepted: true, ...decision })
    } catch (error) {
      results.push({ question: entry.question, expectedRoute: entry.route, expectedQueryMode: entry.queryMode,
        accepted: false, reason: error instanceof Error ? error.message : 'Jev decision rejected' })
    }
  }
  const report = { generation: 'live', channel: configuration.channel, savedEnabled: configuration.enabled,
    diagnosticOnly: true, results }
  console.info('Jev Notes synthetic diagnostic', JSON.stringify(report))
  if (process.env.JEV_NOTES_OUTPUT_PATH) await writeFile(process.env.JEV_NOTES_OUTPUT_PATH,
    JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  // Uncertain decisions are expected to be rejected, then tested through the hybrid fallback separately.
  expect(results.some(result => result.accepted)).toBe(true)
  expect(results.filter(result => result.accepted).every(result => 'route' in result &&
    result.route === result.expectedRoute && result.queryMode === result.expectedQueryMode)).toBe(true)
}, 90_000)
