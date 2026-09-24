import { readFile, writeFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import type { ModelProvider } from '../shared/ai'
import { getSelectedCardModules } from '../shared/card-modules'
import { classifyEnglishRequest } from './router-classifier'
import { generateKnowledgeCard } from './knowledge-card-service'

const LIVE_TIMEOUT_MS = 180_000
const ABORT_MARGIN_MS = 5_000
const cases = [
  { name: 'word', question: 'resilient 用来形容一个人时是什么意思？请解释用法，给两个例句。', examples: 2 },
  { name: 'grammar_concept', question: '讲解现在完成时的基本结构和主要用法，给三个例句。', examples: 3 }
]
it.skipIf(process.env.STAGE_LATENCY_LIVE !== '1').each(cases)('live stage latency: $name', async sample => {
  const settingsPath = process.env.COVERAGE_REGRESSION_SETTINGS_PATH
  expect(settingsPath).toBeTruthy()
  const settings = JSON.parse(await readFile(settingsPath!, 'utf8')) as {
    modelProvider: ModelProvider; apiKeys: Partial<Record<ModelProvider, string>>;
    models: Partial<Record<ModelProvider, string>>
  }
  const apiKey = settings.apiKeys[settings.modelProvider]
  const modelName = settings.models[settings.modelProvider]
  expect(Boolean(apiKey && modelName)).toBe(true)
  const connection = { apiKey: apiKey!, modelName: modelName!, modelProvider: settings.modelProvider,
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS - ABORT_MARGIN_MS) }
  const timing: unknown[] = []
  const originalLog = console.info
  const log = vi.spyOn(console, 'info').mockImplementation((event, details) => {
    if (event === 'EnglishAsk model request finished') timing.push(details)
    originalLog(event, details)
  })
  const startedAt = performance.now()
  try {
    const classification = await classifyEnglishRequest({ ...connection,
      request: { requestId: `latency-${sample.name}`, question: sample.question, history: [] } })
    const card = await generateKnowledgeCard({ ...connection, answerLanguage: 'zh',
      request: { sourceQuestion: sample.question, classification, recentContext: [] } })
    const prefix = process.env.STAGE_LATENCY_OUTPUT_PREFIX
    if (prefix) await writeFile(`${prefix}-${sample.name}.json`, JSON.stringify({ question: sample.question,
      model: modelName, elapsedMs: Math.round(performance.now() - startedAt), timing, classification, card }, null, 2), 'utf8')
    expect(classification.inputType).toBe(sample.name)
    expect(card.sections.map(s => s.module)).toEqual(getSelectedCardModules(classification))
    expect(card.sections.find(s => s.module === 'examples')?.examples).toHaveLength(sample.examples)
  } finally { log.mockRestore() }
}, LIVE_TIMEOUT_MS)
