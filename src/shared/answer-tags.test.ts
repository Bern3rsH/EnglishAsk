import { expect, it } from 'vitest'
import { classificationTags, getAnswerTags, isAnswerTags, withNoteTags } from './answer-tags'
import { ROUTER_INPUT_TYPES, ROUTER_INTENTS } from './router'

it('maps every known card type and intent to Chinese tags without guessing unknowns', () => {
  for (const type of ROUTER_INPUT_TYPES) for (const intent of ROUTER_INTENTS) {
    const tags = classificationTags(type, intent)
    expect(isAnswerTags(tags)).toBe(true)
    expect(tags).toHaveLength(Number(type !== 'unknown') + Number(intent !== 'unknown'))
  }
  expect(classificationTags('word', 'explain_meaning')).toEqual(['单词', '解释含义'])
  expect(isAnswerTags(['made-up-tag'])).toBe(false)
})

it('does not tag user questions or legacy unclassified messages', () => {
  const message = { id: 'm', role: 'user' as const, content: 'Hi', createdAt: 'today', answerTags: ['单词'] }
  expect(getAnswerTags(message)).toEqual([])
  expect(getAnswerTags({ ...message, role: 'assistant', answerTags: undefined })).toEqual([])
})

it('adds editable Markdown tags once while preserving frontmatter and existing tags', () => {
  const tags = ['单词', '解释含义']
  const result = withNoteTags('---\ntitle: test\n---\n\n#复习 #单词\n\n## 含义\n正文', tags)
  expect(result).toBe('---\ntitle: test\n---\n\n#单词 #解释含义 #复习\n\n## 含义\n正文')
  expect(withNoteTags(result, tags)).toBe(result)
  expect(withNoteTags('# Heading\n正文', tags)).toBe('#单词 #解释含义\n\n# Heading\n正文')
  expect(withNoteTags('Original', [])).toBe('Original')
})
