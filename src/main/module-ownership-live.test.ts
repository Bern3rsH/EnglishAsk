import { readFile, writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import type { ModelProvider } from '../shared/ai'
import type { RouterClassification } from '../shared/router'
import { generateKnowledgeCard } from './knowledge-card-service'

const LIVE_TIMEOUT_MS = 180_000
const ABORT_MARGIN_MS = 5_000
const cases: { name: string; question: string; classification: RouterClassification }[] = [
  { name: 'take-off', question: 'take off 表示脱下衣服时怎么用？代词应该放在哪里？给两个例句。',
    classification: { inputType: 'phrase', structureType: 'fixed_expression', targetText: 'take off',
      targets: ['take off'], focusText: '脱下衣服；代词位置', intent: 'explain_usage',
      modules: ['meaning', 'grammar', 'usage', 'examples'], confidence: 1, needsClarification: false,
      clarificationQuestion: '', responseMode: 'card' } },
  { name: 'say-tell', question: 'say 和 tell 有什么区别？解释用法并给两个例句。',
    classification: { inputType: 'comparison', structureType: 'multi_target_comparison', targetText: 'say vs tell',
      targets: ['say', 'tell'], focusText: '', intent: 'compare_difference',
      modules: ['comparison', 'usage', 'examples'], confidence: 1, needsClarification: false,
      clarificationQuestion: '', responseMode: 'card' } }
]

it.skipIf(process.env.MODULE_OWNERSHIP_LIVE !== '1').each(cases)('live module ownership: $name', async sample => {
  const settingsPath = process.env.COVERAGE_REGRESSION_SETTINGS_PATH
  expect(settingsPath).toBeTruthy()
  const settings = JSON.parse(await readFile(settingsPath!, 'utf8')) as {
    modelProvider: ModelProvider; apiKeys: Partial<Record<ModelProvider, string>>;
    models: Partial<Record<ModelProvider, string>>
  }
  const apiKey = settings.apiKeys[settings.modelProvider]
  const modelName = settings.models[settings.modelProvider]
  expect(Boolean(apiKey && modelName)).toBe(true)
  const card = await generateKnowledgeCard({ apiKey: apiKey!, modelName: modelName!,
    modelProvider: settings.modelProvider, answerLanguage: 'zh',
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS - ABORT_MARGIN_MS),
    request: { sourceQuestion: sample.question, classification: sample.classification, recentContext: [] } })
  const prefix = process.env.MODULE_OWNERSHIP_OUTPUT_PREFIX
  if (prefix) await writeFile(`${prefix}-${sample.name}.json`, JSON.stringify(card, null, 2), 'utf8')
  expect(card.sections.map(section => section.module)).toEqual(sample.classification.modules)
  expect(card.sections.find(section => section.module === 'examples')?.examples).toHaveLength(2)
  const usage = card.sections.find(section => section.module === 'usage')!.content
  expect(usage).toMatch(/[\u3400-\u9fff]/)
  if (sample.name === 'take-off') {
    const grammar = card.sections.find(section => section.module === 'grammar')!.content
    expect(grammar).toMatch(/人称代词/)
    expect(grammar).toMatch(/非重读|不重读|弱读|非强调|无重音|轻读/)
    expect(usage).not.toMatch(/代词[^。\n]*(?:中间|之间)|take (?:it|them) off/i)
  } else {
    expect(usage).not.toMatch(/say something to someone|tell someone something/i)
  }
  // These catch specific observed repetition; inspect saved prose for semantic overlap and accuracy.
}, LIVE_TIMEOUT_MS)
