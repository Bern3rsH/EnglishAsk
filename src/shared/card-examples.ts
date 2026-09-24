import type { KnowledgeCard, KnowledgeCardExample, KnowledgeCardSection } from './knowledge-card'
import type { DefaultAnswerLanguage } from './ai'

const MAX_EXAMPLE_CHARACTERS = 4_000
const MAX_EXAMPLES_PER_SECTION = 100
const CHINESE_TEXT = /[\u3400-\u9fff]/u
const BLOCK_MARKER = /^\s*(?:\d+[.)]\s|[-*+]\s|#{1,6}\s|```)/m
const ENGLISH_ONLY_EXAMPLES = /\bEnglish[- ]only examples\b|\bexamples? (?:in English only|without (?:Chinese )?translations?)\b|例句(?:只用英文|仅用英文|不要中文|无需翻译|不需要翻译)|(?:只要|仅要)英文例句/i

export class ExampleValidationError extends Error {
  constructor(detail: string) {
    super('Invalid example format: ' + detail + ' Please retry.')
    this.name = 'ExampleValidationError'
  }
}

export function parseCardExamples(value: unknown): KnowledgeCardExample[] {
  if (!Array.isArray(value) || value.length > MAX_EXAMPLES_PER_SECTION) {
    throw new ExampleValidationError('expected a bounded example list.')
  }
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.english !== 'string' ||
        !item.english.trim() || item.english.length > MAX_EXAMPLE_CHARACTERS ||
        (item.translation !== undefined && (typeof item.translation !== 'string' ||
          !item.translation.trim() || item.translation.length > MAX_EXAMPLE_CHARACTERS))) {
      throw new ExampleValidationError('each example needs English text and a valid optional translation.')
    }
    if (CHINESE_TEXT.test(item.english) || BLOCK_MARKER.test(item.english) ||
        (item.translation !== undefined && BLOCK_MARKER.test(item.translation))) {
      throw new ExampleValidationError('keep English and translation separate and omit list markers.')
    }
    return { english: item.english.trim(), ...(item.translation === undefined ? {} : { translation: item.translation.trim() }) }
  })
}

export function requiresExampleTranslations(language: DefaultAnswerLanguage, question: string): boolean {
  return language === 'zh' && !ENGLISH_ONLY_EXAMPLES.test(question)
}

export function validateGeneratedExamples(card: KnowledgeCard, requireTranslations: boolean, requireExampleModule = false): void {
  if (requireExampleModule && !card.sections.some(section => section.module === 'examples')) {
    throw new ExampleValidationError('the requested examples module is missing.')
  }
  for (const section of card.sections) {
    if (section.module === 'examples' && (!section.examples?.length || section.content.trim())) {
      throw new ExampleValidationError('the examples module must use paired examples, not Markdown content.')
    }
    for (const example of section.examples ?? []) {
      if (requireTranslations && (!example.translation || !CHINESE_TEXT.test(example.translation))) {
        throw new ExampleValidationError('Chinese answers require a Chinese translation for every example.')
      }
    }
  }
}

export function formatCardSection(section: KnowledgeCardSection): string {
  if (!section.examples?.length) return section.content
  const examples = section.examples.map((example, index) => {
    const marker = String(index + 1) + '. '
    const indent = ' '.repeat(marker.length)
    const english = example.english.split(/\r?\n/).join('  \n' + indent)
    const translation = example.translation
      ? '  \n' + indent + example.translation.split(/\r?\n/).join('  \n' + indent) : ''
    return marker + english + translation
  }).join('\n')
  return [section.content.trim(), examples].filter(Boolean).join('\n\n')
}
