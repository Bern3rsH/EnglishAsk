import type { KnowledgeCard, KnowledgeCardType } from './knowledge-card'
import { ROUTER_MODULES, type RouterClassification, type RouterInputType, type RouterModule } from './router'

const PHRASE_ORDER = ['meaning', 'grammar', 'usage', 'collocations', 'examples', 'common_mistakes', 'translation'] as const
const SENTENCE_ORDER = ['sentence_structure', 'grammar', 'tense', 'voice', 'word_breakdown', 'collocations', 'translation', 'common_mistakes'] as const

export const CARD_MODULE_RULES = {
  word: { defaults: ['meaning', 'phonetic', 'usage', 'examples'],
    order: ['meaning', 'phonetic', 'pronunciation', 'usage', 'grammar', 'collocations', 'examples', 'common_mistakes', 'translation'] },
  phrase: { defaults: ['meaning', 'usage', 'examples'], order: PHRASE_ORDER },
  collocation: { defaults: ['meaning', 'usage', 'collocations', 'examples'], order: PHRASE_ORDER },
  pattern: { defaults: ['meaning', 'grammar', 'usage', 'examples'], order: PHRASE_ORDER },
  sentence: { defaults: ['sentence_structure', 'grammar'], order: SENTENCE_ORDER },
  paragraph: { defaults: ['sentence_structure', 'grammar'], order: SENTENCE_ORDER },
  grammar_concept: { defaults: ['meaning', 'grammar', 'usage', 'examples'],
    order: ['meaning', 'grammar', 'usage', 'tense', 'comparison', 'examples', 'common_mistakes'] },
  comparison: { defaults: ['comparison', 'usage', 'examples'],
    order: ['comparison', 'meaning', 'grammar', 'usage', 'collocations', 'examples', 'common_mistakes', 'translation'] }
} as const satisfies Record<KnowledgeCardType, { defaults: readonly RouterModule[]; order: readonly RouterModule[] }>

export function getCardModuleOrder(type: RouterInputType): RouterModule[] {
  const primary: readonly RouterModule[] = type === 'unknown' ? [] : CARD_MODULE_RULES[type].order
  // Supplemental explanations stay supported, but examples always close the card.
  const explanations = [...primary, ...ROUTER_MODULES.filter(module => !primary.includes(module))]
    .filter(module => module !== 'examples')
  return [...explanations, 'examples']
}

export function getSelectedCardModules(classification: Pick<RouterClassification, 'inputType' | 'modules'>): RouterModule[] {
  const modules: readonly RouterModule[] = classification.modules.length || classification.inputType === 'unknown'
    ? classification.modules : CARD_MODULE_RULES[classification.inputType].defaults
  return getCardModuleOrder(classification.inputType).filter(module => modules.includes(module))
}

export class CardModuleValidationError extends Error {
  constructor(readonly missingModules: RouterModule[]) {
    super(`Answer is missing required modules: ${missingModules.join(', ')}. Please retry.`)
    this.name = 'CardModuleValidationError'
  }
}

export function validateGeneratedCardModules(card: KnowledgeCard, classification: RouterClassification): void {
  const present = new Set(card.sections.map(section => section.module))
  const missing = getSelectedCardModules(classification).filter(module => !present.has(module))
  if (missing.length) throw new CardModuleValidationError(missing)
}

export function formatModuleList(modules: readonly RouterModule[]): string {
  return '[' + modules.map(module => JSON.stringify(module)).join(', ') + ']'
}

export function formatCardModulePolicy(types: readonly KnowledgeCardType[]): string {
  return types.map(type => `${type}:\nDefault modules when modules is empty: ${formatModuleList(CARD_MODULE_RULES[type].defaults)}\nModule order: ${formatModuleList(getCardModuleOrder(type))}`).join('\n')
}
