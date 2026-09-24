import { readFile, writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import type { ModelProvider } from '../shared/ai'
import type { KnowledgeCard } from '../shared/knowledge-card'
import type { RouterClassification } from '../shared/router'
import { GRAMMAR_REVIEW_TIMEOUT_MS, reviewGrammar } from './grammar-review'

const cases = [
  { name: 'when-zh', language: 'zh', bad: true,
    content: 'when 是已结束过去时间的标志，所以所有 when 从句都不能用现在完成时。',
    expected: /语境|从句|未来|不.*决定/ },
  { name: 'when-en', language: 'en', bad: true,
    content: 'Every when-clause refers to a finished past time, so it cannot use the present perfect.',
    expected: /context|future|completion|not.*(?:past|determine)/i },
  { name: 'participle-zh', language: 'zh', bad: true,
    content: '过去分词的形式一定不同于一般过去式，所以 have worked 是错误的。',
    expected: /相同|同形|一样/ },
  { name: 'participle-en', language: 'en', bad: true,
    content: 'A past participle always looks different from the past simple, so have bought is incorrect.',
    expected: /same|identical|share/i },
  { name: 'scoped-zh', language: 'zh', bad: false,
    content: 'when 本身不决定时态；when I was a child 给出已结束的过去时间，而 when you have finished 可以表示未来某个动作之前完成。',
    expected: /when you have finished/ },
  { name: 'scoped-en', language: 'en', bad: false,
    content: 'Perfect have/has selects a past participle. Past-simple forms and past participles have different grammatical roles but can share a form, as in worked/worked and bought/bought; went/gone differ.',
    expected: /worked\/worked/ }
] as const

it.skipIf(process.env.GRAMMAR_BOUNDARIES_LIVE !== '1').each(cases)(
  'live grammar boundary: $name', async testCase => {
    const settingsPath = process.env.GRAMMAR_REVIEW_SETTINGS_PATH
    expect(settingsPath).toBeTruthy()
    const settings = JSON.parse(await readFile(settingsPath!, 'utf8')) as {
      modelProvider: ModelProvider
      apiKeys: Partial<Record<ModelProvider, string>>
      models: Partial<Record<ModelProvider, string>>
    }
    const apiKey = settings.apiKeys[settings.modelProvider]
    const modelName = settings.models[settings.modelProvider]
    expect(Boolean(apiKey && modelName)).toBe(true)
    const classification: RouterClassification = {
      inputType: 'grammar_concept', structureType: 'abstract_concept',
      targetText: 'present perfect', targets: ['present perfect'], focusText: '',
      intent: 'explain_grammar', modules: ['grammar'], confidence: 1,
      needsClarification: false, clarificationQuestion: '', responseMode: 'card'
    }
    const draft: KnowledgeCard = {
      cardType: 'grammar_concept', targetText: classification.targetText, targets: classification.targets,
      answer: testCase.language === 'zh' ? '下面说明相关语法。' : 'The relevant grammar is explained below.',
      sections: [{ module: 'grammar', content: testCase.content }]
    }
    const card = await reviewGrammar(draft, classification, {
      apiKey: apiKey!, modelName: modelName!, modelProvider: settings.modelProvider,
      prompt: JSON.stringify({ sourceQuestion: testCase.language === 'zh'
        ? '解释现在完成时的形式和时间框架。' : 'Explain present-perfect forms and time frames.',
      router: classification, recentContext: [], settings: { answerLanguage: testCase.language } })
    })
    const outputPrefix = process.env.GRAMMAR_BOUNDARIES_OUTPUT_PREFIX
    if (outputPrefix) await writeFile(`${outputPrefix}-${testCase.name}.json`,
      JSON.stringify({ modelName, testCase, card }, null, 2), 'utf8')
    if (testCase.bad) expect(card.sections[0].content).not.toBe(testCase.content)
    else expect(card).toEqual(draft)
    expect(card.sections[0].content).toMatch(testCase.expected)
    expect(card.targets).toEqual(draft.targets)
    expect(card.sections.map(section => section.module)).toEqual(['grammar'])
    // Pattern checks only detect regressions; inspect saved synthetic answers for semantic accuracy.
  }, GRAMMAR_REVIEW_TIMEOUT_MS + 5_000
)
