import { beforeEach, expect, it, vi } from 'vitest'
import type { KnowledgeCard } from '../shared/knowledge-card'
import type { RouterClassification, RouterModule } from '../shared/router'
import { needsGrammarReview, reviewGrammar } from './grammar-review'
import { generateProviderText } from './provider-adapters'

vi.mock('./provider-adapters', () => ({ generateProviderText: vi.fn() }))
beforeEach(() => vi.resetAllMocks())

const route: RouterClassification = { inputType: 'word', structureType: 'single_word', targetText: 'resilient',
  targets: ['resilient'], focusText: '', intent: 'explain_meaning', modules: ['meaning', 'usage', 'examples'],
  responseMode: 'card', needsClarification: false, clarificationQuestion: '', confidence: 1 }
const card: KnowledgeCard = { cardType: 'word', targetText: 'resilient', targets: ['resilient'],
  answer: 'Able to recover after difficulties.', sections: [{ module: 'usage', content: 'An adjective describing people who recover after setbacks.' },
    { module: 'examples', content: '', examples: [{ english: 'I must always try again.', translation: '我必须不断尝试。' }] }] }
const connection = { apiKey: 'test', modelName: 'test', modelProvider: 'openai' as const,
  prompt: JSON.stringify({ sourceQuestion: 'resilient' }) }

it.each(['word', 'phrase', 'collocation', 'comparison'] as const)('skips ordinary %s explanations without a provider call', async type => {
  const ordinary = { ...card, cardType: type, sections: [...card.sections,
    { module: 'common_mistakes' as const, content: 'Use heavy rain rather than strong rain in ordinary weather descriptions.' }] }
  expect(await reviewGrammar(ordinary, { ...route, inputType: type, modules: ['usage', 'comparison', 'common_mistakes', 'examples'] }, connection)).toBe(ordinary)
  expect(generateProviderText).not.toHaveBeenCalled()
})

it('skips ordinary translation and does not mistake learning material for an assertion', async () => {
  const translated: KnowledgeCard = { ...card, answer: 'You must always try again.', sections: [
    { module: 'translation', content: 'The verb cannot take an object.' }] }
  expect(await reviewGrammar(translated, { ...route, intent: 'translate', modules: ['translation'] }, connection)).toBe(translated)
  expect(generateProviderText).not.toHaveBeenCalled()
})

it.each(['explain_grammar', 'correct_sentence', 'analyze_sentence'] as const)('retains explicit %s review even without grammar keywords', async intent => {
  vi.mocked(generateProviderText).mockResolvedValue('{"corrections":[]}')
  await reviewGrammar(card, { ...route, intent }, connection)
  expect(generateProviderText).toHaveBeenCalledTimes(1)
})

it.each(['grammar', 'tense', 'voice', 'sentence_structure'] as RouterModule[])('reviews requested %s but not an incidental generated module', module => {
  expect(needsGrammarReview(card, { ...route, modules: [module] })).toBe(true)
  expect(needsGrammarReview({ ...card, sections: [{ module, content: 'Explanation.' }] }, route)).toBe(false)
})

it('retains grammar concepts, but pattern meaning alone does not require review', () => {
  expect(needsGrammarReview({ ...card, cardType: 'grammar_concept' }, { ...route, inputType: 'grammar_concept' })).toBe(true)
  expect(needsGrammarReview({ ...card, cardType: 'pattern' }, { ...route, inputType: 'pattern' })).toBe(false)
})

it.each([
  'The past simple has no connection with the present.',
  'Gone is a past participle, not a past tense.',
  'sb is an indirect object.',
  'This verb cannot take an object.',
  'The pronoun must precede off.',
  'You must put the object before off.',
  '一般过去时和现在完全无关。',
  'sb 是间接宾语。',
  '代词必须放在中间。',
  'go 的被动语态是 be gone。'
])('does not trigger an automatic provider call from explanation wording alone: %s', async content => {
  const ordinary = { ...card, answer: content, sections: [{ module: 'usage' as const, content }] }
  expect(await reviewGrammar(ordinary, route, connection)).toBe(ordinary)
  expect(generateProviderText).not.toHaveBeenCalled()
})

it.each(['translate', 'generate_examples', 'ask_pronunciation', 'polish_expression'] as const)(
  'skips automatic review for %s even with grammar material', async intent => {
    const ordinary = { ...card, cardType: 'grammar_concept' as const, sections: [{ module: 'grammar' as const, content: '过去分词与过去式。' }] }
    expect(await reviewGrammar(ordinary, { ...route, intent, modules: ['grammar'] }, connection)).toBe(ordinary)
    expect(generateProviderText).not.toHaveBeenCalled()
  })

it('retains tense/voice comparisons even when the draft lacks technical wording', () => {
  expect(needsGrammarReview({ ...card, cardType: 'comparison' }, { ...route, inputType: 'comparison',
    targets: ['present perfect', 'past simple'], modules: ['comparison', 'examples'] })).toBe(true)
})
