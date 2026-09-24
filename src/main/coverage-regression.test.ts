import { beforeEach, expect, it, vi } from 'vitest'
import type { KnowledgeCard } from '../shared/knowledge-card'
import type { RouterClassification } from '../shared/router'
import { GRAMMAR_ACCURACY_RULES, GRAMMAR_REVIEW_PROMPT, SENTENCE_CARD_PROMPT } from '../shared/prompt-design'
import { reviewGrammar } from './grammar-review'
import { generateProviderText } from './provider-adapters'

vi.mock('./provider-adapters', () => ({ generateProviderText: vi.fn() }))
beforeEach(() => vi.resetAllMocks())

const classification: RouterClassification = {
  inputType: 'grammar_concept', structureType: 'abstract_concept',
  targetText: 'present perfect', targets: ['present perfect'], focusText: '',
  intent: 'explain_grammar', modules: ['grammar'], confidence: 1,
  needsClarification: false, clarificationQuestion: '', responseMode: 'card'
}
const options = {
  apiKey: 'test-key', modelName: 'test-model', modelProvider: 'openai' as const,
  prompt: JSON.stringify({ sourceQuestion: '讲解现在完成时。', settings: { answerLanguage: 'zh' } })
}
const makeCard = (content: string): KnowledgeCard => ({
  cardType: 'grammar_concept', targetText: 'present perfect', targets: ['present perfect'],
  answer: '现在完成时的结构如下。', sections: [{ module: 'grammar', content }]
})

it('scopes the participle rule to auxiliary have in both generation and review', () => {
  expect(GRAMMAR_ACCURACY_RULES).toContain('when it functions as the perfect auxiliary')
  for (const boundary of ['have breakfast', 'has to leave', 'have someone check']) {
    expect(GRAMMAR_ACCURACY_RULES).toContain(boundary)
  }
  expect(GRAMMAR_ACCURACY_RULES).toContain('even inside a lesson about the present perfect')
  expect(GRAMMAR_REVIEW_PROMPT).toContain(GRAMMAR_ACCURACY_RULES)
  expect(GRAMMAR_REVIEW_PROMPT).toContain('Do not return a correction merely to make already-correct wording more explicit')
  expect(GRAMMAR_REVIEW_PROMPT).toContain('Preserve such valid scoped statements verbatim')
  expect(SENTENCE_CARD_PROMPT).toContain(GRAMMAR_ACCURACY_RULES)
})

it('requires relevant paragraph endpoints without expanding a narrow focus', () => {
  expect(SENTENCE_CARD_PROMPT).toContain('both endpoints of the contrast, cause/result, reference or substitution')
  expect(SENTENCE_CARD_PROMPT).toContain('planned walk, the rain and the taxi decision')
  expect(SENTENCE_CARD_PROMPT).toContain('do not mechanically analyze every sentence')
  expect(SENTENCE_CARD_PROMPT).toContain('do not append an invented parallel paragraph')
  expect(SENTENCE_CARD_PROMPT).toContain('Preserve explicitly requested examples and their translations')
  expect(GRAMMAR_REVIEW_PROMPT).toContain('retain its coverage of the relevant sentences/clauses')
})

// Mocked corrections verify transport and preservation, not model judgement.
it.each([
  ['只要前面是 have/has，后面的形式就是过去分词。', '在现在完成时结构中，助动词 have/has 后接过去分词。'],
  ['Anything following have/has is a past participle.', 'In the present perfect, auxiliary have/has selects a past participle.']
])('applies a local have-scope correction: %s', async (bad, good) => {
  const suffix = ' worked/worked 和 bought/bought 可以同形。'
  const original = makeCard(bad + suffix)
  vi.mocked(generateProviderText).mockResolvedValueOnce(JSON.stringify({ corrections: [{
    field: 'grammar', quote: bad, reason: 'Distinguish perfect auxiliary have from other constructions.',
    replacement: good + suffix
  }] }))
  const result = await reviewGrammar(original, classification, options)
  expect(result.sections[0].content).toBe(good + suffix)
  expect(result.answer).toBe(original.answer)
  expect(original.sections[0].content).toBe(bad + suffix)
  expect(generateProviderText).toHaveBeenCalledTimes(1)
})

it('preserves a correctly scoped auxiliary rule', async () => {
  const original = makeCard('在现在完成时结构中，助动词 have/has 后接过去分词；worked 可与过去式同形。')
  vi.mocked(generateProviderText).mockResolvedValueOnce('{"corrections":[]}')
  expect(await reviewGrammar(original, classification, options)).toBe(original)
})

it('keeps paragraph endpoints when applying a connective correction', async () => {
  const target = 'I had planned to walk home. However, it started to rain, so I took a taxi instead.'
  const bad = 'However 是并列连词。'
  const surrounding = '第一句说明原计划步行。第二句的 it started to rain 说明下雨，I took a taxi 说明结果，instead 指乘车替代步行。'
  const original: KnowledgeCard = { cardType: 'paragraph', targetText: target, targets: [target],
    answer: '原计划因雨改变。', sections: [{ module: 'sentence_structure', content: surrounding + bad }] }
  vi.mocked(generateProviderText).mockResolvedValueOnce(JSON.stringify({ corrections: [{
    field: 'sentence_structure', quote: bad, reason: 'However is a linking adverb.',
    replacement: surrounding + 'However 是连接副词。'
  }] }))
  const result = await reviewGrammar(original, { ...classification, inputType: 'paragraph',
    structureType: 'long_text', targetText: target, targets: [target], modules: ['sentence_structure'] }, options)
  expect(result.sections[0].content).toBe(surrounding + 'However 是连接副词。')
  expect(result.targets).toEqual(original.targets)
  expect(result.answer).toBe(original.answer)
})
