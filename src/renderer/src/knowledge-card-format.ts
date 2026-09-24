import type { DefaultAnswerLanguage } from '../../shared/ai'
import type { KnowledgeCard } from '../../shared/knowledge-card'
import type { RouterIntent, RouterModule } from '../../shared/router'
import { formatCardSection } from '../../shared/card-examples'

const CHINESE_TEXT_PATTERN = /[\u3400-\u9fff]{2}/u
const MEANING_FIRST_CARD_TYPES: ReadonlySet<KnowledgeCard['cardType']> = new Set([
  'word',
  'phrase',
  'collocation',
  'pattern'
])

const CHINESE_MODULE_LABELS: Record<RouterModule, string> = {
  meaning: '含义',
  phonetic: '音标',
  pronunciation: '发音',
  examples: '例句',
  usage: '用法',
  grammar: '语法',
  tense: '时态',
  voice: '语态',
  sentence_structure: '句子结构',
  word_breakdown: '词语拆解',
  collocations: '常见搭配',
  common_mistakes: '常见错误',
  translation: '翻译',
  comparison: '对比'
}

const formatEnglishModuleLabel = (module: RouterModule): string => {
  return module
    .split('_')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

export const inferKnowledgeCardAnswerLanguage = (
  card: KnowledgeCard
): DefaultAnswerLanguage => {
  return CHINESE_TEXT_PATTERN.test(card.answer) ? 'zh' : 'en'
}

export const formatKnowledgeCardAsMarkdown = (
  card: KnowledgeCard,
  answerLanguage: DefaultAnswerLanguage,
  intent?: RouterIntent
): string => {
  const formatModuleLabel = (module: RouterModule): string =>
    answerLanguage === 'zh'
      ? CHINESE_MODULE_LABELS[module]
      : formatEnglishModuleLabel(module)
  const startsWithMeaning =
    intent === 'explain_meaning' &&
    MEANING_FIRST_CARD_TYPES.has(card.cardType) &&
    card.sections.some(
      (section) => section.module === 'meaning' && section.content.trim().length > 0
    )

  return [
    ...(startsWithMeaning ? [] : [card.answer]),
    ...card.sections.map(
      (section) => `## ${formatModuleLabel(section.module)}\n\n${formatCardSection(section)}`
    )
  ].join('\n\n')
}
