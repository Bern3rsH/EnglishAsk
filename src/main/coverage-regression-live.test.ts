import { readFile, writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import type { ModelProvider } from '../shared/ai'
import type { KnowledgeCard } from '../shared/knowledge-card'
import type { RouterClassification } from '../shared/router'
import { reviewGrammar } from './grammar-review'
import { generateKnowledgeCard } from './knowledge-card-service'

const LIVE_TIMEOUT_MS = 180_000
const ABORT_MARGIN_MS = 5_000
const SOURCE_PARAGRAPH = 'I had planned to walk home. However, it started to rain, so I took a taxi instead.'
const grammarClassification: RouterClassification = {
  inputType: 'grammar_concept', structureType: 'abstract_concept', targetText: 'present perfect',
  targets: ['present perfect'], focusText: '', intent: 'explain_grammar', modules: ['grammar'],
  confidence: 1, needsClarification: false, clarificationQuestion: '', responseMode: 'card'
}
const paragraphClassification: RouterClassification = {
  ...grammarClassification, inputType: 'paragraph', structureType: 'long_text',
  targetText: SOURCE_PARAGRAPH, targets: [SOURCE_PARAGRAPH], focusText: 'However, so, instead',
  intent: 'analyze_sentence', modules: ['sentence_structure', 'grammar']
}
const connection = async () => {
  const path = process.env.COVERAGE_REGRESSION_SETTINGS_PATH
  expect(path).toBeTruthy()
  const settings = JSON.parse(await readFile(path!, 'utf8')) as {
    modelProvider: ModelProvider
    apiKeys: Partial<Record<ModelProvider, string>>
    models: Partial<Record<ModelProvider, string>>
  }
  const apiKey = settings.apiKeys[settings.modelProvider]
  const modelName = settings.models[settings.modelProvider]
  expect(Boolean(apiKey && modelName)).toBe(true)
  return { apiKey: apiKey!, modelName: modelName!, modelProvider: settings.modelProvider,
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS - ABORT_MARGIN_MS) }
}
const saveSample = async (name: string, card: KnowledgeCard) => {
  const prefix = process.env.COVERAGE_REGRESSION_OUTPUT_PREFIX
  if (prefix) await writeFile(`${prefix}-${name}.json`, JSON.stringify(card, null, 2), 'utf8')
}
const expectScopedHaveRule = (content: string) => {
  expect(content).toMatch(/助动词|完成时结构/)
  // Quoting the old claim to explicitly reject it is not asserting that claim.
  if (content.includes('只要前面是 have/has')) {
    expect(content).toMatch(/(?:不能|不要|不应|不可|错误|并非)[^。！？\n]*只要前面是 have\/has/)
  }
}

it.skipIf(process.env.COVERAGE_REGRESSION_LIVE !== '1').each([
  { name: 'have-unscoped', bad: true,
    content: '只要前面是 have/has，后面的形式就是过去分词。worked 与过去式可以同形。' },
  { name: 'have-scoped', bad: false,
    content: '在现在完成时结构中，助动词 have/has 后接过去分词。worked 与过去式可以同形。' }
])('live have boundary: $name', async sample => {
  const original: KnowledgeCard = { cardType: 'grammar_concept', targetText: 'present perfect',
    targets: ['present perfect'], answer: '下面说明现在完成时。',
    sections: [{ module: 'grammar', content: sample.content }] }
  const card = await reviewGrammar(original, grammarClassification, { ...await connection(),
    prompt: JSON.stringify({ sourceQuestion: '讲解现在完成时的结构。',
      router: grammarClassification, settings: { answerLanguage: 'zh' } }) })
  await saveSample(sample.name, card)
  if (sample.bad) {
    expectScopedHaveRule(card.sections[0].content)
    expect(card.sections[0].content).toContain('worked')
  } else expect(card).toEqual(original)
}, LIVE_TIMEOUT_MS)

it.skipIf(process.env.COVERAGE_REGRESSION_LIVE !== '1')('live review preserves paragraph coverage', async () => {
  const content = '第一句 I had planned to walk home 交代原计划步行。第二句 it started to rain 交代下雨，I took a taxi 交代结果；so 连接原因与结果，instead 指乘车代替步行。However 是并列连词。'
  const original: KnowledgeCard = { cardType: 'paragraph', targetText: SOURCE_PARAGRAPH,
    targets: [SOURCE_PARAGRAPH], answer: '原计划因下雨改变。',
    sections: [{ module: 'sentence_structure', content }] }
  const card = await reviewGrammar(original, { ...paragraphClassification, modules: ['sentence_structure'] }, {
    ...await connection(), prompt: JSON.stringify({ sourceQuestion: '分析这段话的逻辑和结构。',
      router: paragraphClassification, settings: { answerLanguage: 'zh' } }) })
  await saveSample('paragraph-review', card)
  expect(card.sections[0].content).not.toContain('However 是并列连词')
  for (const fragment of ['walk home', 'started to rain', 'took a taxi', 'instead']) {
    expect(card.sections[0].content).toContain(fragment)
  }
  expect(card.sections).toHaveLength(1)
}, LIVE_TIMEOUT_MS)

it.skipIf(process.env.COVERAGE_REGRESSION_LIVE !== '1').each([
  { name: 'paragraph-generation', classification: paragraphClassification,
    question: `分析这段话的句间逻辑和衔接：${SOURCE_PARAGRAPH}` },
  { name: 'grammar-generation', classification: { ...grammarClassification,
    modules: ['grammar', 'usage', 'examples'] as RouterClassification['modules'] },
    question: '讲解现在完成时的基本结构和主要用法，给三个例句。' }
])('live repaired generation: $name', async sample => {
  const card = await generateKnowledgeCard({ ...await connection(), answerLanguage: 'zh',
    request: { sourceQuestion: sample.question, classification: sample.classification, recentContext: [] } })
  await saveSample(sample.name, card)
  expect(card.sections.map(section => section.module)).toEqual(sample.classification.modules)
  if (sample.name === 'paragraph-generation') {
    const structure = card.sections.find(section => section.module === 'sentence_structure')!.content
    expect(structure).toMatch(/步行|walk/)
    expect(structure).toMatch(/下雨|rain/)
    expect(structure).toMatch(/出租车|乘车|taxi/)
    expect(structure).toMatch(/转折|改变|然而/)
    expect(structure).toMatch(/因果|结果|导致|所以/)
    expect(card.sections.every(section => !section.examples?.length)).toBe(true)
  } else {
    const grammar = card.sections.find(section => section.module === 'grammar')!.content
    expectScopedHaveRule(grammar)
    expect(card.sections.find(section => section.module === 'examples')?.examples).toHaveLength(3)
  }
  // Saved answers still require semantic inspection; lexical assertions are not a quality proof.
}, LIVE_TIMEOUT_MS)
