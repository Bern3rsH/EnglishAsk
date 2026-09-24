import { beforeEach, expect, it, vi } from 'vitest'
import type { DefaultAnswerLanguage } from '../shared/ai'
import type { KnowledgeCard, KnowledgeCardType } from '../shared/knowledge-card'
import type { RouterClassification, RouterStructureType } from '../shared/router'
import { CONTENT_FOCUS_AND_LANGUAGE_RULES, GRAMMAR_ACCURACY_RULES } from '../shared/prompt-design'
import { generateKnowledgeCard } from './knowledge-card-service'
import { generateProviderText } from './provider-adapters'

vi.mock('./provider-adapters', () => ({ generateProviderText: vi.fn() }))
beforeEach(() => vi.resetAllMocks())

it('assigns focused word order and distinct-word comparison details to one module', () => {
  expect(CONTENT_FOCUS_AND_LANGUAGE_RULES).toContain('grammar owns its detailed positions')
  expect(CONTENT_FOCUS_AND_LANGUAGE_RULES).toContain('If grammar is absent, usage may own that rule')
  expect(CONTENT_FOCUS_AND_LANGUAGE_RULES).toContain('rather than reproducing the same formulas as a second bullet list')
  expect(CONTENT_FOCUS_AND_LANGUAGE_RULES).toContain('not a necessary condition for their meanings to overlap')
})

const cases: { type: KnowledgeCardType; structure: RouterStructureType; targets: string[]; question: string; calls: number }[] = [
  { type: 'word', structure: 'single_word', targets: ['went'], question: 'went 和原形是什么关系？', calls: 1 },
  { type: 'phrase', structure: 'fixed_expression', targets: ['cold turkey'], question: 'cold turkey 是什么意思？', calls: 1 },
  { type: 'collocation', structure: 'collocation', targets: ['heavy rain'], question: 'heavy rain 为什么自然？', calls: 1 },
  { type: 'pattern', structure: 'pattern', targets: ['ask sb to do sth'], question: '解释 ask sb to do sth。', calls: 1 },
  { type: 'sentence', structure: 'complete_sentence', targets: ['He took off his coat.'], question: '这里 take off 是什么意思？', calls: 1 },
  { type: 'paragraph', structure: 'long_text', targets: ['It rained. We stayed home.'], question: '解释第二句和第一句的关系。', calls: 1 },
  { type: 'grammar_concept', structure: 'abstract_concept', targets: ['present perfect'], question: '现在完成时表示什么？', calls: 2 },
  { type: 'comparison', structure: 'multi_target_comparison', targets: ['say', 'tell'], question: 'say 和 tell 有什么区别？', calls: 1 }
]

// These check request composition and call counts, not the semantic quality of mocked prose.
it.each(cases.flatMap(testCase => (['zh', 'en'] as DefaultAnswerLanguage[]).map(language => ({ ...testCase, language }))))(
  'passes focus/language guidance to $type in $language without an extra content-review call',
  async testCase => {
    const classification: RouterClassification = {
      inputType: testCase.type, structureType: testCase.structure, targetText: testCase.targets.join(' vs '),
      targets: testCase.targets, focusText: 'requested sense', intent: 'explain_meaning',
      modules: testCase.type === 'comparison' ? ['comparison'] : ['meaning'], confidence: 1,
      needsClarification: false, clarificationQuestion: '', responseMode: 'card'
    }
    const card: KnowledgeCard = { cardType: testCase.type, targetText: classification.targetText,
      targets: testCase.targets, answer: 'A concise explanation.',
      sections: classification.modules.map(module => ({ module, content: 'Relevant explanation.' })) }
    vi.mocked(generateProviderText).mockResolvedValueOnce(JSON.stringify(card))
      .mockResolvedValueOnce('{"corrections":[]}')
    const result = await generateKnowledgeCard({
      answerLanguage: testCase.language, apiKey: 'test-key', modelName: 'test-model', modelProvider: 'openai',
      request: { sourceQuestion: testCase.question, classification, recentContext: [{ role: 'assistant', content: 'Earlier answer in another language.' }] }
    })
    expect(result).toEqual(card)
    expect(generateProviderText).toHaveBeenCalledTimes(testCase.calls)
    const first = vi.mocked(generateProviderText).mock.calls[0][0]
    expect(first.systemPrompt).toContain(CONTENT_FOCUS_AND_LANGUAGE_RULES)
    expect(first.systemPrompt).toContain(GRAMMAR_ACCURACY_RULES)
    if (testCase.calls === 2) {
      const review = vi.mocked(generateProviderText).mock.calls[1][0]
      expect(review.systemPrompt).toContain(GRAMMAR_ACCURACY_RULES)
      expect(review.purpose).toBe('grammar-review')
    }
    expect(first.systemPrompt).toContain(testCase.language === 'zh' ? 'write Simplified Chinese explanations' : 'write English explanations')
    expect(JSON.parse(first.prompt)).toMatchObject({ sourceQuestion: testCase.question,
      router: { targets: testCase.targets, focusText: 'requested sense' }, settings: { answerLanguage: testCase.language } })
    expect(first.systemPrompt).not.toContain('translation in the same JSON string field')
  }
)
