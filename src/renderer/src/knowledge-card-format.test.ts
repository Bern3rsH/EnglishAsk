import { describe, expect, it } from 'vitest'
import type { KnowledgeCard } from '../../shared/knowledge-card'
import { ROUTER_INTENTS } from '../../shared/router'
import {
  formatKnowledgeCardAsMarkdown,
  inferKnowledgeCardAnswerLanguage
} from './knowledge-card-format'

const wordCard: KnowledgeCard = {
  cardType: 'word',
  targetText: 'develop',
  targets: ['develop'],
  answer: '“develop” 常表示发展、开发或逐渐形成。',
  sections: [
    { module: 'meaning', content: '动词：发展；开发。' },
    { module: 'phonetic', content: '/dɪˈveləp/' },
    { module: 'usage', content: '可作及物或不及物动词。' },
    { module: 'examples', content: '- Children develop quickly.' }
  ]
}

describe('knowledge-card Markdown formatting', () => {
  it('uses Chinese section headings for Chinese answers', () => {
    const markdown = formatKnowledgeCardAsMarkdown(wordCard, 'zh')

    expect(markdown).toContain('## 含义')
    expect(markdown).toContain('## 音标')
    expect(markdown).toContain('## 用法')
    expect(markdown).toContain('## 例句')
    expect(markdown).not.toContain('## Meaning')
  })

  it('keeps English section headings for English answers', () => {
    const markdown = formatKnowledgeCardAsMarkdown(wordCard, 'en')

    expect(markdown).toContain('## Meaning')
    expect(markdown).toContain('## Phonetic')
    expect(markdown).toContain('## Usage')
    expect(markdown).toContain('## Examples')
  })

  it.each(['word', 'phrase', 'collocation', 'pattern'] as const)(
    'omits the opening summary for a %s meaning request with a definition',
    (cardType) => {
      const card = { ...wordCard, cardType }
      const markdown = formatKnowledgeCardAsMarkdown(card, 'zh', 'explain_meaning')

      expect(markdown).toBe(
        '## 含义\n\n动词：发展；开发。\n\n' +
        '## 音标\n\n/dɪˈveləp/\n\n' +
        '## 用法\n\n可作及物或不及物动词。\n\n' +
        '## 例句\n\n- Children develop quickly.'
      )
      expect(markdown).not.toContain(card.answer)
      expect(card.answer).toBe(wordCard.answer)
    }
  )

  it('also omits the opening summary in English without dropping sections', () => {
    const markdown = formatKnowledgeCardAsMarkdown(wordCard, 'en', 'explain_meaning')

    expect(markdown.startsWith('## Meaning\n\n')).toBe(true)
    expect(markdown).not.toContain(wordCard.answer)
    for (const section of wordCard.sections) {
      expect(markdown).toContain(section.content)
    }
  })

  it.each(ROUTER_INTENTS.filter((intent) => intent !== 'explain_meaning'))(
    'preserves the direct answer for %s even when a meaning section exists',
    (intent) => {
      expect(formatKnowledgeCardAsMarkdown(wordCard, 'zh', intent).startsWith(wordCard.answer))
        .toBe(true)
    }
  )

  it.each(['sentence', 'paragraph', 'grammar_concept', 'comparison'] as const)(
    'preserves the direct answer for a %s card',
    (cardType) => {
      const card = { ...wordCard, cardType }

      expect(formatKnowledgeCardAsMarkdown(card, 'zh', 'explain_meaning').startsWith(card.answer))
        .toBe(true)
    }
  )

  it('preserves legacy answers when their intent is unavailable', () => {
    expect(formatKnowledgeCardAsMarkdown(wordCard, 'zh').startsWith(wordCard.answer)).toBe(true)
  })

  it.each([
    { sections: [] },
    { sections: [{ module: 'examples' as const, content: 'Children develop quickly.' }] },
    { sections: [{ module: 'meaning' as const, content: '   ' }] }
  ])('preserves the answer when no usable meaning section exists: %j', ({ sections }) => {
    const markdown = formatKnowledgeCardAsMarkdown(
      { ...wordCard, sections },
      'zh',
      'explain_meaning'
    )

    expect(markdown.startsWith(wordCard.answer)).toBe(true)
  })

  it('infers the language of legacy cards from their direct answer', () => {
    expect(inferKnowledgeCardAnswerLanguage(wordCard)).toBe('zh')
    expect(
      inferKnowledgeCardAnswerLanguage({
        ...wordCard,
        answer: 'Develop commonly means to grow, create, or gradually form.'
      })
    ).toBe('en')
  })
})
