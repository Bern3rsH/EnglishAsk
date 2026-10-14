import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, it, vi } from 'vitest'
import { decideNoteAnswerRoute } from './note-answer-routing'
import { getConfiguredModelProvider, getConfiguredProviderModel, getStoredProviderApiKey, getStoredJevConfiguration } from './settings'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd(),
  getPath: () => dirname(process.env.RAG_ANSWER_SETTINGS_PATH ?? '/missing/settings.json') } }))
vi.mock('./jev-routing-config', async importOriginal => {
  const original = await importOriginal<typeof import('./jev-routing-config')>()
  return { ...original, getJevRoutingConfiguration: async () => {
    if (process.env.JEV_NOTES_FORCE_LIVE !== '1') return original.getJevRoutingConfiguration()
    // Explicit test-only diagnostic override; never changes the saved enable switch.
    const stored = await getStoredJevConfiguration()
    if (!stored.apiKey) throw new Error('Dedicated Jev key required.')
    return { channel: stored.channel, apiKey: stored.apiKey, ...(stored.accountId ? { accountId: stored.accountId } : {}) }
  } }
})

it.skipIf(process.env.RAG_ROUTING_LIVE !== '1')('routes synthetic questions and follow-ups with the configured live model', async () => {
  if (!process.env.RAG_ANSWER_SETTINGS_PATH) throw new Error('RAG_ANSWER_SETTINGS_PATH is required.')
  const modelProvider = await getConfiguredModelProvider()
  const modelName = await getConfiguredProviderModel(modelProvider)
  const apiKey = modelProvider === 'ollama' ? '' : await getStoredProviderApiKey(modelProvider)
  if (apiKey === undefined) throw new Error('Configured credentials required.')
  const history = [
    { id: '1', role: 'user' as const, content: '根据我的笔记解释 draw attention to。', createdAt: '2026-10-11' },
    { id: '2', role: 'assistant' as const, content: '笔记中 draw attention to 表示引起注意。[S1]', createdAt: '2026-10-11' }
  ]
  const cases = [
    { question: 'draw attention to的例句', route: 'standard', history: [] },
    { question: '我的笔记里draw attention to的例句', route: 'notes', history: [] },
    { question: '它的例句呢？', route: 'notes', history },
    { question: '不用我的笔记，解释 present perfect。', route: 'standard', history },
    { question: 'hello 是什么意思？', route: 'standard', history },
    { question: '翻译这句话：I take notes every day.', route: 'standard', history: [] },
    { question: 'RAG 是怎样检索笔记的？', route: 'standard', history: [] }
  ]
  const results = []
  for (const [index, entry] of cases.entries()) {
    const decision = await decideNoteAnswerRoute({ requestId: `live-${index}`, question: entry.question,
      history: entry.history, answerMode: 'auto' }, { modelProvider, modelName, apiKey })
    results.push({ question: entry.question, hasHistory: entry.history.length > 0, expected: entry.route, ...decision })
    expect(decision.route, entry.question).toBe(entry.route)
    if (index === 2) {
      expect(decision.query).toMatch(/draw attention to/)
      expect(decision.query).toMatch(/例句/)
    }
  }
  if (process.env.RAG_ROUTING_OUTPUT_PATH) await writeFile(process.env.RAG_ROUTING_OUTPUT_PATH,
    JSON.stringify({ generation: 'live', testOnlyJevOverride: process.env.JEV_NOTES_FORCE_LIVE === '1',
      provider: modelProvider, model: modelName, results }, null, 2) + '\n', { mode: 0o600 })
  if (process.env.JEV_NOTES_FORCE_LIVE === '1') expect(results.some(result => result.routing.source === 'jev')).toBe(true)
}, 130_000)
