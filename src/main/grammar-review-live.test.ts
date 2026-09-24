import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import type { ModelProvider } from '../shared/ai'
import type { KnowledgeCard } from '../shared/knowledge-card'
import type { RouterClassification } from '../shared/router'
import { GRAMMAR_REVIEW_TIMEOUT_MS, reviewGrammar } from './grammar-review'

const cases = [
  { name: 'object-role', target: 'ask sb to do sth', type: 'pattern',
    bad: '在 ask sb to do sth 中，sb 是间接宾语。',
    question: '讲解 ask sb to do sth 的结构。',
    expected: /宾语/ },
  { name: 'gone-passive', target: 'went', type: 'word',
    bad: 'go 的过去分词是 gone，所以表示去某地时，被动语态应使用 be gone。',
    question: 'went 和原形是什么关系？',
    expected: /不及物|不能|不用于|不构成|没有|并不|不是|不应/ },
  { name: 'past-present-connection', target: 'present perfect', type: 'grammar_concept',
    bad: '一般过去时与现在完全无关，过去事件不会对现在产生任何影响。',
    question: '现在完成时通常在什么情况下使用？',
    expected: /影响|联系|关联|结果/ }
] as const

it.skipIf(process.env.GRAMMAR_REVIEW_LIVE !== '1').each(cases)(
  'live grammar regression: $name',
  async testCase => {
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
      inputType: testCase.type, structureType: testCase.type === 'word' ? 'single_word' : testCase.type === 'pattern' ? 'pattern' : 'abstract_concept',
      targetText: testCase.target, targets: [testCase.target], focusText: '',
      intent: 'explain_grammar', modules: ['grammar'], confidence: 1,
      needsClarification: false, clarificationQuestion: '', responseMode: 'card'
    }
    const draft: KnowledgeCard = {
      cardType: testCase.type, targetText: testCase.target, targets: [testCase.target],
      answer: '下面说明这个语法点。',
      sections: [{ module: 'grammar', content: testCase.bad }]
    }
    const reviewed = await reviewGrammar(draft, classification, {
      apiKey: apiKey!, modelName: modelName!, modelProvider: settings.modelProvider,
      prompt: JSON.stringify({ sourceQuestion: testCase.question, router: classification,
        recentContext: [], settings: { answerLanguage: 'zh' } })
    })
    expect(reviewed.sections[0].content).not.toContain(testCase.bad)
    expect(reviewed.sections[0].content).toMatch(testCase.expected)
    expect(reviewed.targets).toEqual(draft.targets)
    console.info('Live grammar regression correction', { case: testCase.name, content: reviewed.sections[0].content })
  },
  GRAMMAR_REVIEW_TIMEOUT_MS + 5_000
)
