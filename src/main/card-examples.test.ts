import { expect, it } from 'vitest'
import { ExampleValidationError, formatCardSection, parseCardExamples, requiresExampleTranslations, validateGeneratedExamples } from '../shared/card-examples'
import type { KnowledgeCard, KnowledgeCardSection } from '../shared/knowledge-card'
import { parseKnowledgeCard } from '../main/knowledge-card-service'
import type { RouterClassification } from '../shared/router'
import { formatKnowledgeCardAsMarkdown } from '../renderer/src/knowledge-card-format'
import { normalizeChatSessions } from '../renderer/src/chat-history'
import { applyGrammarCorrections } from '../main/grammar-review'
import { getAskNoteOriginalMarkdown } from '../renderer/src/ask-note-topics'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownContent } from '../renderer/src/markdown'

const examples = [{ english: 'I went home.', translation: '我回家了。' }]
const section: KnowledgeCardSection = { module: 'examples', content: '', examples }
const card: KnowledgeCard = { cardType: 'word', targetText: 'went', targets: ['went'],
  answer: 'went 是 go 的过去式。', sections: [section] }
const route: RouterClassification = { inputType: 'word', structureType: 'single_word', targetText: 'went',
  targets: ['went'], intent: 'explain_meaning', modules: ['examples'], confidence: 1,
  needsClarification: false, clarificationQuestion: '', focusText: '', responseMode: 'card' }

it('parses structured examples and preserves legacy Markdown', () => {
  expect(parseKnowledgeCard(JSON.stringify(card), route)).toEqual(card)
  const legacy = { ...card, sections: [{ module: 'examples', content: '- I went home.' }] }
  expect(parseKnowledgeCard(JSON.stringify(legacy), route)).toEqual(legacy)
  expect(formatCardSection(legacy.sections[0] as KnowledgeCardSection)).toBe('- I went home.')
})
it.each([null, {}, [null], [{ english: '' }], [{ english: 'I went home.', translation: '' }],
  [{ english: 'I went home.', translation: 123 }], [{ english: '1. I went home.' }],
  [{ english: 'I went home. 我回家了。' }], [{ english: 'x'.repeat(4001) }]])(
  'rejects malformed example data %#', value => {
    expect(() => parseCardExamples(value)).toThrow(ExampleValidationError)
  }
)
it('requires Chinese translations in every module, not just examples', () => {
  expect(() => validateGeneratedExamples(card, true)).not.toThrow()
  for (const module of ['examples', 'usage', 'grammar'] as const) {
    const invalid = { ...card, sections: [{ module, content: '', examples: [{ english: 'I went home.' }] }] }
    expect(() => validateGeneratedExamples(invalid, true)).toThrow(ExampleValidationError)
    expect(() => validateGeneratedExamples(invalid, false)).not.toThrow()
  }
  expect(() => validateGeneratedExamples({ ...card, sections: [{
    ...section, examples: [{ english: 'I went home.', translation: 'I went home.' }]
  }] }, true)).toThrow()
})
it('rejects legacy example format only for newly generated answers', () => {
  expect(() => validateGeneratedExamples({ ...card, sections: [] }, true, true)).toThrow()
  for (const content of ['- I went home.', '']) {
    expect(() => validateGeneratedExamples({ ...card, sections: [{ module: 'examples', content }] }, false)).toThrow()
  }
  expect(() => validateGeneratedExamples({ ...card, sections: [{ ...section, content: '1. I went home.' }] }, true)).toThrow()
})
it('respects English mode and explicit English-only examples', () => {
  expect(requiresExampleTranslations('zh', '解释 went')).toBe(true)
  expect(requiresExampleTranslations('en', '解释 went')).toBe(false)
  expect(requiresExampleTranslations('zh', 'Give English-only examples.')).toBe(false)
  expect(requiresExampleTranslations('zh', '讲解 went，例句不要中文')).toBe(false)
})
it('formats paired examples deterministically, including multi-line dialogue and two-digit numbering', () => {
  expect(formatCardSection(section)).toBe('1. I went home.  \n   我回家了。')
  const many = Array.from({ length: 10 }, () => examples[0])
  expect(formatCardSection({ ...section, examples: many })).toContain('10. I went home.  \n    我回家了。')
  expect(formatCardSection({ ...section, examples: [{ english: 'A: Hi.\nB: Hello.', translation: '甲：你好。\n乙：你好。' }] }))
    .toBe('1. A: Hi.  \n   B: Hello.  \n   甲：你好。  \n   乙：你好。')
})
it('includes supporting examples in module content and exports the same Markdown to Notes', () => {
  const withUsage: KnowledgeCard = { ...card, sections: [{ module: 'usage', content: '用于过去。', examples }, section] }
  const markdown = formatKnowledgeCardAsMarkdown(withUsage, 'zh')
  expect(markdown).toContain('## 用法\n\n用于过去。\n\n1. I went home.  \n   我回家了。')
  expect(getAskNoteOriginalMarkdown([{ id: 'a', role: 'assistant', content: markdown, createdAt: '2026-09-13' }])).toBe(markdown)
})
it('renders each translation inside its English numbered list item', () => {
  const markdown = formatCardSection({ ...section, examples: [...examples, { english: 'She left.', translation: '她走了。' }] })
  const html = renderToStaticMarkup(createElement(MarkdownContent, { content: markdown }))
  expect(html.match(/<li[ >]/g)).toHaveLength(2)
  expect(html).toMatch(/<li[^>]*>[^]*?I went home\.[^]*?我回家了。[^]*?<\/li>/)
  expect(html).toMatch(/<li[^>]*>[^]*?She left\.[^]*?她走了。[^]*?<\/li>/)
})
it('round-trips structured examples in history without migrating legacy data', () => {
  const session = { id: 'test', title: 'went', createdAt: '2026-09-13', updatedAt: '2026-09-13',
    messages: [{ id: 'm', role: 'assistant', content: card.answer, knowledgeCard: card, createdAt: '2026-09-13' }] }
  const restored = normalizeChatSessions(JSON.parse(JSON.stringify([session])))
  expect(restored[0].messages[0].knowledgeCard).toEqual(card)
})
it('allows grammar review to repair individual paired example fields', () => {
  const bad: KnowledgeCard = { ...card, sections: [{ ...section,
    examples: [{ english: 'I have went home.', translation: '我回家了。' }] }] }
  const repaired = applyGrammarCorrections(bad, JSON.stringify({ corrections: [{
    field: 'examples.examples.0.english', quote: 'I have went home.', reason: 'Use the past participle.',
    replacement: 'I have gone home.'
  }] })).card
  expect(repaired.sections[0].examples).toEqual([{ english: 'I have gone home.', translation: '我回家了。' }])
  expect(repaired.sections[0].content).toBe('')
  expect(() => validateGeneratedExamples(repaired, true)).not.toThrow()
})
