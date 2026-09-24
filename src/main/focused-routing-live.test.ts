import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import type { ModelProvider } from '../shared/ai'
import { classifyEnglishRequest } from './router-classifier'
import { generateKnowledgeCard } from './knowledge-card-service'

const LIVE_TIMEOUT_MS = 180_000
const ABORT_MARGIN_MS = 5_000
const cases = [
  { name: 'went focus', question: 'went 是什么意思？它和原形 go、过去分词 gone 是什么关系？go 表示“去”时能用被动语态吗？给两个例句。',
    targets: ['went', 'go', 'gone'], modules: ['comparison', 'examples'], passive: true, generate: true },
  { name: 'unseen lemma forms', question: 'write、wrote、written 三种形式是什么关系？给两个例句。',
    targets: ['write', 'wrote', 'written'], modules: ['comparison', 'examples'], generate: false },
  { name: 'explicit usage section', question: '对比 go、went、gone，请分别设置对比、用法和例句三个独立章节，给两个例句。',
    targets: ['go', 'went', 'gone'], modules: ['comparison', 'usage', 'examples'], generate: false },
  { name: 'legitimate concepts', question: '主动语态和被动语态有什么区别？', generate: false }
]

it.skipIf(process.env.FOCUSED_ROUTING_LIVE !== '1').each(cases)('live focused routing: $name', async testCase => {
  const settingsPath = process.env.FOCUSED_ROUTING_SETTINGS_PATH
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
  const classification = await classifyEnglishRequest({ ...connection,
    request: { requestId: `focus-${testCase.name}`, question: testCase.question, history: [] } })
  expect(classification.inputType).toBe('comparison')
  expect(classification.responseMode).toBe('card')
  if (testCase.targets) {
    expect(classification.targets).toEqual(testCase.targets)
    if (testCase.passive) {
      expect(classification.targetText).not.toMatch(/被动|passive/i)
      expect(classification.focusText).toMatch(/被动|passive/i)
    }
    expect([...classification.modules].sort()).toEqual([...testCase.modules!].sort())
  } else {
    expect(classification.targets).toHaveLength(2)
    expect(classification.targets[0]).toMatch(/主动|active/i)
    expect(classification.targets[1]).toMatch(/被动|passive/i)
  }
  if (testCase.generate) {
    const card = await generateKnowledgeCard({ ...connection, answerLanguage: 'zh',
      request: { sourceQuestion: testCase.question, classification, recentContext: [] } })
    expect(card.targets).toEqual(testCase.targets)
    expect(card.sections.map(section => section.module)).toEqual(testCase.modules)
    expect(card.sections.find(section => section.module === 'comparison')?.content).toMatch(/被动/)
    expect(card.sections.at(-1)?.examples).toHaveLength(2)
    // Emit this synthetic test answer for human inspection; never output settings or keys.
    console.info('Focused routing live answer', JSON.stringify(card))
  }
}, LIVE_TIMEOUT_MS)
