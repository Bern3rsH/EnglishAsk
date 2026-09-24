import type { JevChannel } from './jev'
export const ROUTER_INPUT_TYPES = [
  'word',
  'phrase',
  'collocation',
  'pattern',
  'sentence',
  'paragraph',
  'grammar_concept',
  'comparison',
  'unknown'
] as const

export const ROUTER_STRUCTURE_TYPES = [
  'single_word',
  'fixed_expression',
  'collocation',
  'pattern',
  'complete_sentence',
  'long_text',
  'abstract_concept',
  'multi_target_comparison',
  'unknown'
] as const

export const ROUTER_INTENTS = [
  'explain_meaning',
  'explain_usage',
  'explain_grammar',
  'analyze_sentence',
  'translate',
  'correct_sentence',
  'polish_expression',
  'ask_pronunciation',
  'generate_examples',
  'compare_difference',
  'unknown'
] as const

export const ROUTER_MODULES = [
  'meaning',
  'phonetic',
  'pronunciation',
  'examples',
  'usage',
  'grammar',
  'tense',
  'voice',
  'sentence_structure',
  'word_breakdown',
  'collocations',
  'common_mistakes',
  'translation',
  'comparison'
] as const

export const ROUTER_RESPONSE_MODES = [
  'card',
  'clarification',
  'conversational'
] as const

export type RouterInputType = (typeof ROUTER_INPUT_TYPES)[number]
export type RouterStructureType = (typeof ROUTER_STRUCTURE_TYPES)[number]
export type RouterIntent = (typeof ROUTER_INTENTS)[number]
export type RouterModule = (typeof ROUTER_MODULES)[number]
export type RouterResponseMode = (typeof ROUTER_RESPONSE_MODES)[number]

export interface RouterClassification {
  inputType: RouterInputType
  structureType: RouterStructureType
  targetText: string
  targets: string[]
  focusText: string
  intent: RouterIntent
  modules: RouterModule[]
  confidence: number
  needsClarification: boolean
  clarificationQuestion: string
  responseMode: RouterResponseMode
}

export interface RouterRoutingInfo {
  source: 'rule' | 'original' | 'jev-assisted' | 'jev-fallback'
  channel?: JevChannel
}

export type RouterDiagnostic = { routing?: RouterRoutingInfo } & (
  | {
      status: 'success'
      classification: RouterClassification
    }
  | {
      status: 'error'
      message: string
    }
)
