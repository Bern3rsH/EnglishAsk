import type { ChatMessage } from './ai'
import type { RouterInputType, RouterIntent } from './router'

export const CARD_TYPE_LABELS: Record<RouterInputType, string> = {
  word: '单词', phrase: '短语', collocation: '搭配', pattern: '句型', sentence: '句子',
  paragraph: '段落', grammar_concept: '语法概念', comparison: '对比', unknown: '未识别'
}
export const INTENT_LABELS: Record<RouterIntent, string> = {
  explain_meaning: '解释含义', explain_usage: '解释用法', explain_grammar: '讲解语法',
  analyze_sentence: '分析句子', translate: '翻译', correct_sentence: '纠正句子',
  polish_expression: '润色表达', ask_pronunciation: '查询发音', generate_examples: '生成例句',
  compare_difference: '比较差异', unknown: '未识别'
}
const knownTags = new Set([...Object.values(CARD_TYPE_LABELS), ...Object.values(INTENT_LABELS)].filter(tag => tag !== '未识别'))
export const isAnswerTags = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= knownTags.size && value.every(tag => typeof tag === 'string' && knownTags.has(tag))

export function classificationTags(type: RouterInputType, intent: RouterIntent): string[] {
  return [type !== 'unknown' ? CARD_TYPE_LABELS[type] : '', intent !== 'unknown' ? INTENT_LABELS[intent] : ''].filter(Boolean)
}

export function getAnswerTags(message: ChatMessage): string[] {
  if (message.role !== 'assistant') return []
  if (isAnswerTags(message.answerTags)) return [...new Set(message.answerTags)]
  const classification = message.routerDiagnostic?.status === 'success' ? message.routerDiagnostic.classification : undefined
  if (classification?.responseMode === 'card') return classificationTags(message.knowledgeCard?.cardType ?? classification.inputType, classification.intent)
  return message.knowledgeCard ? classificationTags(message.knowledgeCard.cardType, 'unknown') : []
}

export function withNoteTags(markdown: string, tags: string[]): string {
  if (!tags.length) return markdown
  const frontmatter = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? ''
  const body = markdown.slice(frontmatter.length).trimStart()
  const firstLine = body.split(/\r?\n/, 1)[0]
  const hasTagLine = /^#[^\s#]+(?:[ \t]+#[^\s#]+)*$/.test(firstLine)
  const existing = hasTagLine ? firstLine.split(/\s+/).map(tag => tag.slice(1)) : []
  const line = [...new Set([...tags, ...existing])].map(tag => `#${tag}`).join(' ')
  return `${frontmatter}${frontmatter ? '\n' : ''}${line}\n\n${hasTagLine ? body.slice(firstLine.length).trimStart() : body}`
}
