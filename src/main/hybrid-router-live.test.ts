import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { ModelProvider } from '../shared/ai'
import { classifyWithHybridRouter } from './hybrid-router'
import { askEnglish } from './ai-service'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd(),
  getPath: () => dirname(process.env.JEV_ROUTER_SETTINGS_PATH ?? '/missing/settings.json') } }))

const REQUEST_TIMEOUT_MS = 90_000
it.skipIf(process.env.JEV_HYBRID_LIVE !== '1')('runs actual hybrid routes and one complete Ask', async () => {
  const path = process.env.JEV_ROUTER_SETTINGS_PATH
  if (!path) throw new Error('JEV_ROUTER_SETTINGS_PATH is required')
  const settings = JSON.parse(await readFile(path, 'utf8')) as {
    modelProvider: ModelProvider; models: Record<ModelProvider, string>; apiKeys: Record<ModelProvider, string>
  }
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required')
  const sources: unknown[] = []
  const log = vi.spyOn(console, 'info').mockImplementation((event, details) => {
    if (event === 'EnglishAsk routing source' || event === 'EnglishAsk routing fallback') sources.push(details)
  })
  const results: unknown[] = []
  try {
    for (const sample of [
      { question: 'resilient', mode: 'card' },
      { question: 'say 和 tell 有什么区别？', mode: 'card' },
      { question: '它和另一个有什么区别？', mode: 'clarification' }
    ]) {
      const start = performance.now()
      const classification = await classifyWithHybridRouter({
        apiKey: settings.apiKeys[settings.modelProvider], modelName: settings.models[settings.modelProvider],
        modelProvider: settings.modelProvider, jevApiKey: process.env.OPENROUTER_API_KEY,
        request: { requestId: 'hybrid-live', question: sample.question, history: [] },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      results.push({ question: sample.question, classification, elapsedMs: Math.round(performance.now() - start) })
      expect(classification.responseMode).toBe(sample.mode)
      if (sample.question.startsWith('say')) expect(classification.targets).toEqual(['say', 'tell'])
    }
    const response = await askEnglish({ requestId: 'hybrid-full-ask', question: 'resilient', history: [] },
      { includeRouterDiagnostic: true, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    results.push({ fullAsk: response })
    expect(response.knowledgeCard?.cardType).toBe('word')
    expect(response.knowledgeCard?.sections.map(section => section.module)).toEqual(['meaning', 'phonetic', 'usage', 'examples'])
    expect(response.model).toBe(settings.models[settings.modelProvider])
    expect(sources).toContainEqual(expect.objectContaining({ source: 'rule' }))
    expect(sources).toContainEqual(expect.objectContaining({ source: 'jev-assisted' }))
  } finally {
    log.mockRestore()
    const outputPath = join(tmpdir(), `englishask-hybrid-router-${Date.now()}.json`)
    await writeFile(outputPath, JSON.stringify({ sources, results }, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    console.info('Hybrid routing evidence', outputPath)
  }
}, REQUEST_TIMEOUT_MS * 4)
