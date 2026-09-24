import type {
  RouterClassification,
  RouterModule
} from './router'

export const KNOWLEDGE_CARD_CONTEXT_MESSAGE_LIMIT = 6
export const KNOWLEDGE_CARD_TYPES = [
  'word',
  'phrase',
  'collocation',
  'pattern',
  'sentence',
  'paragraph',
  'grammar_concept',
  'comparison'
] as const

export type KnowledgeCardType = (typeof KNOWLEDGE_CARD_TYPES)[number]

export interface KnowledgeCardExample {
  english: string
  translation?: string
}

export interface KnowledgeCardSection {
  module: RouterModule
  content: string
  examples?: KnowledgeCardExample[]
}

export interface KnowledgeCard {
  cardType: KnowledgeCardType
  targetText: string
  targets: string[]
  answer: string
  sections: KnowledgeCardSection[]
}

export interface KnowledgeCardContextMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface GenerateKnowledgeCardRequest {
  sourceQuestion: string
  recentContext: KnowledgeCardContextMessage[]
  classification: RouterClassification
}
