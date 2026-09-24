import { readFile, writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import type { ModelProvider } from '../shared/ai'
import type { KnowledgeCard } from '../shared/knowledge-card'
import type { RouterClassification, RouterIntent } from '../shared/router'
import { getSelectedCardModules } from '../shared/card-modules'
import { getMessagePronunciationTargets } from '../renderer/src/pronunciation'
import { classifyEnglishRequest } from './router-classifier'
import { generateKnowledgeCard } from './knowledge-card-service'

const LIVE_TIMEOUT_MS = 180_000
const ABORT_MARGIN_MS = 5_000
const cases: { name: string; question: string; intent?: RouterIntent }[] = [
  { name: 'translation', question: '把这句话翻译成自然的英语：我明天可能会晚到十分钟。', intent: 'translate' },
  { name: 'correction', question: '只纠正语法错误，不要润色：She go to school every day.', intent: 'correct_sentence' },
  { name: 'polishing', question: '润色这封邮件中的请求，保持礼貌、自然，不要增加新的事实：Could you send me the report by Friday?', intent: 'polish_expression' },
  { name: 'polishing-grounded', question: '润色这封邮件中的请求，保持礼貌、自然，不要增加新的事实：Could you send me the report by Friday?', intent: 'polish_expression' },
  { name: 'pronunciation', question: 'comfortable 的美式发音是什么？请给音标和重音说明。', intent: 'ask_pronunciation' },
  { name: 'clarification', question: '请帮我纠正下面这句话的语法，但我还没有把句子发给你。' }
]

it.skipIf(process.env.INTENT_COVERAGE_LIVE !== '1').each(cases)('live intent coverage: $name', async sample => {
  const settingsPath = process.env.COVERAGE_REGRESSION_SETTINGS_PATH
  expect(settingsPath).toBeTruthy()
  const settings = JSON.parse(await readFile(settingsPath!, 'utf8')) as {
    modelProvider: ModelProvider
    apiKeys: Partial<Record<ModelProvider, string>>
    models: Partial<Record<ModelProvider, string>>
  }
  const apiKey = settings.apiKeys[settings.modelProvider]
  const modelName = settings.models[settings.modelProvider]
  expect(Boolean(apiKey && modelName)).toBe(true)
  const connection = { apiKey: apiKey!, modelName: modelName!, modelProvider: settings.modelProvider,
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS - ABORT_MARGIN_MS) }
  const startedAt = performance.now()
  const routedClassification = await classifyEnglishRequest({ ...connection,
    request: { requestId: `intent-${sample.name}`, question: sample.question, history: [] } })
  // Reproduce the failing module contract even if the Router chooses different modules.
  const classification: RouterClassification = sample.name === 'polishing-grounded'
    ? { ...routedClassification, modules: ['sentence_structure', 'usage', 'common_mistakes'] }
    : routedClassification
  let card: KnowledgeCard | undefined
  if (classification.responseMode === 'card') {
    card = await generateKnowledgeCard({ ...connection, answerLanguage: 'zh',
      request: { sourceQuestion: sample.question, classification, recentContext: [] } })
  }
  const prefix = process.env.INTENT_COVERAGE_OUTPUT_PREFIX
  if (prefix) await writeFile(`${prefix}-${sample.name}.json`, JSON.stringify({ question: sample.question,
    model: modelName, elapsedMs: Math.round(performance.now() - startedAt), routedClassification, classification, card }, null, 2), 'utf8')

  if (sample.name === 'clarification') {
    expect(classification.responseMode).toBe('clarification')
    expect(classification.needsClarification).toBe(true)
    expect(classification.clarificationQuestion).toMatch(/\p{Script=Han}/u)
    expect(card).toBeUndefined()
    return
  }
  expect(classification.intent).toBe(sample.intent)
  expect(classification.responseMode).toBe('card')
  expect(card).toBeDefined()
  expect(card!.sections.map(section => section.module)).toEqual(getSelectedCardModules(classification))
  const content = JSON.stringify(card)
  expect(content).toMatch(/\p{Script=Han}/u)
  const pronunciationTargets = getMessagePronunciationTargets({ id: sample.name, role: 'assistant',
    content: card!.answer, createdAt: new Date().toISOString(), knowledgeCard: card,
    routerDiagnostic: { status: 'success', classification } })
  if (sample.name === 'translation') {
    expect(card!.answer).toMatch(/\b(?:may|might)\b/i)
    expect(card!.answer).toMatch(/\b(?:ten|10) minutes?\b/i)
    expect(card!.answer).toMatch(/tomorrow/i)
    expect(pronunciationTargets).toEqual([])
  } else if (sample.name === 'correction') {
    expect(card!.answer.replace(/[*_`]/g, '')).toContain('She goes to school every day.')
  } else if (sample.name.startsWith('polishing')) {
    expect(card!.answer).toMatch(/report/i)
    expect(card!.answer).toMatch(/by Friday/i)
    const mistakes = card!.sections.find(section => section.module === 'common_mistakes')
    if (mistakes) {
      expect(mistakes.content).toMatch(/没有.{0,8}错误|无.{0,4}错误|无需|不需要|语法正确|语法.{0,4}没有问题/)
      expect(mistakes.content).not.toMatch(/Could you to send|send to me the report/i)
    }
  } else if (sample.name === 'pronunciation') {
    expect(pronunciationTargets).toEqual(['comfortable'])
    expect(content).toMatch(/ˈ/)
    expect(content).toMatch(/重音/)
  }
  // Lexical checks catch omissions; saved samples still need semantic inspection.
}, LIVE_TIMEOUT_MS)
