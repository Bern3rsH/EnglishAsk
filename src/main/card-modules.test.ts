import { expect, it } from 'vitest'
import { CARD_MODULE_RULES, formatCardModulePolicy, formatModuleList, getCardModuleOrder, getSelectedCardModules, validateGeneratedCardModules } from '../shared/card-modules'
import { KNOWLEDGE_CARD_TYPES, type KnowledgeCard } from '../shared/knowledge-card'
import { ROUTER_MODULES, type RouterClassification, type RouterModule } from '../shared/router'
import { ROUTER_CLASSIFIER_PROMPT, WORD_CARD_PROMPT, PHRASE_PATTERN_CARD_PROMPT, SENTENCE_CARD_PROMPT, GRAMMAR_CONCEPT_CARD_PROMPT, COMPARISON_CARD_PROMPT } from '../shared/prompt-design'
import { parseKnowledgeCard } from './knowledge-card-service'
import { formatKnowledgeCardAsMarkdown } from '../renderer/src/knowledge-card-format'
import { normalizeChatSessions } from '../renderer/src/chat-history'

const route: RouterClassification = {
  inputType: 'comparison', structureType: 'multi_target_comparison', targetText: 'heavy rain vs strong rain',
  targets: ['heavy rain', 'strong rain'], focusText: '', intent: 'compare_difference',
  modules: ['comparison', 'collocations', 'usage', 'examples'], confidence: 1,
  needsClarification: false, clarificationQuestion: '', responseMode: 'card'
}
function makeCard(classification: RouterClassification, modules: readonly RouterModule[]): KnowledgeCard {
  return { cardType: classification.inputType as KnowledgeCard['cardType'],
    targetText: classification.targetText, targets: [...classification.targets], answer: 'Explanation.',
    sections: modules.map(module => ({ module, content: module === 'phonetic' ? '- **UK/US:** /test/' : module })) }
}

it.each(KNOWLEDGE_CARD_TYPES)('uses one complete unique module policy for %s', inputType => {
  const order = getCardModuleOrder(inputType)
  expect(new Set(order).size).toBe(ROUTER_MODULES.length)
  expect([...order].sort()).toEqual([...ROUTER_MODULES].sort())
  const classification = { ...route, inputType, modules: [...order].reverse() }
  const original = makeCard(classification, classification.modules)
  const parsed = parseKnowledgeCard(JSON.stringify(original), classification)
  expect(parsed.sections.map(section => section.module)).toEqual(order)
  expect(original.sections.map(section => section.module)).toEqual([...order].reverse())
  expect(parseKnowledgeCard(JSON.stringify(parsed), classification)).toEqual(parsed)
  expect(getSelectedCardModules({ ...classification, modules: [] })).toEqual([...CARD_MODULE_RULES[inputType].defaults])
})

it('fixes heavy rain ordering independently of Router and model ordering', () => {
  const card = makeCard(route, ['examples', 'collocations', 'comparison', 'usage', 'usage', 'translation'])
  const parsed = parseKnowledgeCard(JSON.stringify(card), route)
  expect(parsed.sections.map(section => section.module)).toEqual(['comparison', 'usage', 'collocations', 'examples'])
  const markdown = formatKnowledgeCardAsMarkdown(parsed, 'en')
  expect(markdown.indexOf('## Usage')).toBeLessThan(markdown.indexOf('## Collocations'))
})

it.each(KNOWLEDGE_CARD_TYPES)('puts all selected explanations before examples for %s', inputType => {
  const classification = { ...route, inputType,
    modules: ['examples', 'voice', 'tense', 'grammar', 'common_mistakes', 'translation'] as RouterModule[] }
  const card = parseKnowledgeCard(JSON.stringify(makeCard(classification, classification.modules)), classification)
  expect(card.sections.at(-1)?.module).toBe('examples')
  expect(new Set(card.sections.map(section => section.module))).toEqual(new Set(classification.modules))
})

it('uses type defaults when Router selects no modules, and removes unselected enrichment', () => {
  const classification = { ...route, modules: [] }
  const parsed = parseKnowledgeCard(JSON.stringify(makeCard(classification, ['translation', 'examples', 'usage', 'comparison'])), classification)
  expect(parsed.sections.map(section => section.module)).toEqual(['comparison', 'usage', 'examples'])
})

it('preserves explicitly requested modules outside the primary type order', () => {
  const classification = { ...route, inputType: 'phrase' as const, modules: ['phonetic', 'usage'] as RouterModule[] }
  const parsed = parseKnowledgeCard(JSON.stringify(makeCard(classification, classification.modules)), classification)
  expect(parsed.sections.map(section => section.module)).toEqual(['usage', 'phonetic'])
})

it('validates missing selected/default modules only on the new-generation path', () => {
  const legacy = makeCard(route, ['comparison'])
  expect(parseKnowledgeCard(JSON.stringify(legacy), route)).toEqual(legacy)
  expect(() => validateGeneratedCardModules(legacy, route)).toThrow('usage, collocations, examples')
  expect(() => validateGeneratedCardModules(legacy, { ...route, modules: [] })).toThrow('usage, examples')
  expect(() => validateGeneratedCardModules(makeCard(route, route.modules), route)).not.toThrow()
  expect(() => parseKnowledgeCard(JSON.stringify(makeCard(route, ['translation'])), route)).toThrow('required modules')
})

it('does not reorder persisted answers or change stored Markdown', () => {
  const card = makeCard(route, route.modules)
  const markdown = formatKnowledgeCardAsMarkdown(card, 'en')
  const session = { id: 'old', title: 'Old answer', createdAt: '2026-09-13', updatedAt: '2026-09-13',
    messages: [{ id: 'answer', role: 'assistant', content: markdown, createdAt: '2026-09-13', knowledgeCard: card }] }
  const restored = normalizeChatSessions(JSON.parse(JSON.stringify([session])))[0]
  expect(restored.messages[0].knowledgeCard).toEqual(card)
  expect(restored.messages[0].content).toBe(markdown)
})

it('derives every generator and Router default from the shared policy', () => {
  const groups = [
    { prompt: WORD_CARD_PROMPT, types: ['word'] as const },
    { prompt: PHRASE_PATTERN_CARD_PROMPT, types: ['phrase', 'collocation', 'pattern'] as const },
    { prompt: SENTENCE_CARD_PROMPT, types: ['sentence', 'paragraph'] as const },
    { prompt: GRAMMAR_CONCEPT_CARD_PROMPT, types: ['grammar_concept'] as const },
    { prompt: COMPARISON_CARD_PROMPT, types: ['comparison'] as const }
  ]
  for (const group of groups) expect(group.prompt).toContain(formatCardModulePolicy(group.types))
  for (const type of KNOWLEDGE_CARD_TYPES) {
    expect(ROUTER_CLASSIFIER_PROMPT).toContain(`Default ${type} modules: ${formatModuleList(CARD_MODULE_RULES[type].defaults)}`)
  }
})
