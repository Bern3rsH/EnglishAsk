import { expect, it } from 'vitest'
import type { GenerateKnowledgeCardRequest, KnowledgeCard } from './knowledge-card'
import { resolveExampleCount, validateExampleCount } from './example-count'

const request: GenerateKnowledgeCardRequest = {
  sourceQuestion: 'Explain cold turkey.', recentContext: [], classification: {
    inputType: 'phrase', structureType: 'fixed_expression', targetText: 'cold turkey', targets: ['cold turkey'],
    focusText: '', intent: 'explain_usage', modules: ['usage', 'examples'], confidence: 1,
    needsClarification: false, clarificationQuestion: '', responseMode: 'card'
  }
}

it.each(['word', 'phrase', 'collocation', 'pattern', 'sentence', 'paragraph'] as const)(
  'retains the general count for %s', inputType => {
    expect(resolveExampleCount({ ...request, classification: { ...request.classification, inputType } }))
      .toEqual({ count: 2, source: 'default' })
  }
)
it('retains grammar and comparison defaults', () => {
  expect(resolveExampleCount({ ...request, classification: { ...request.classification, inputType: 'grammar_concept' } }).count).toBe(3)
  expect(resolveExampleCount({ ...request, classification: { ...request.classification, inputType: 'comparison', targets: ['a', 'b', 'c'] } }).count).toBe(3)
})
it.each([
  ['Give 5 examples.', 5], ['Give ONE example.', 1], ['Give three simple examples.', 3],
  ['请给五个例句', 5], ['给两句例句', 2], ['给十二条例句', 12], ['给二十个例句', 20],
  ['给100个例句', 100], ['给一百个例句', 100], ['再给3个例句', 3],
  ['Give twenty-one examples.', 21], ['Give thirty five examples.', 35], ['Give one hundred examples.', 100]
])('resolves explicit quantity: %s', (sourceQuestion, count) => {
  expect(resolveExampleCount({ ...request, sourceQuestion: String(sourceQuestion) })).toEqual({ count, source: 'request' })
})
it('multiplies per-target counts once', () => {
  expect(resolveExampleCount({ ...request, sourceQuestion: 'Give two examples for each word.',
    classification: { ...request.classification, targets: ['a', 'b', 'c'] } }).count).toBe(6)
})
it.each(['Give at least 3 examples.', 'Give 2-4 examples.', '至少给三个例句', 'Give 2 examples, or 3 examples.',
  'Give two to four examples.', 'Give several examples.', '给几个例句', '给三到五个例句'])(
  'does not replace a flexible quantity with an exact default: %s', sourceQuestion => {
    expect(resolveExampleCount({ ...request, sourceQuestion })).toEqual({ count: null, source: 'unresolved' })
  }
)
it.each(['Give 0 examples.', 'Give 101 examples.'])(
  'rejects unsupported counts before generation: %s', sourceQuestion => {
    expect(() => resolveExampleCount({ ...request, sourceQuestion })).toThrow('between 1 and 100')
  }
)
it('ignores quoted learning material and unrelated numbers', () => {
  expect(resolveExampleCount({ ...request, sourceQuestion: 'Translate "Give three examples".' }).source).toBe('default')
  expect(resolveExampleCount({ ...request, sourceQuestion: 'Explain 3 meanings with examples.' }).count).toBe(2)
})
it('counts only examples-module items, not translations or supporting examples', () => {
  const example = { english: 'I left.', translation: '我走了。' }
  const card: KnowledgeCard = { cardType: 'phrase', targetText: 'cold turkey', targets: ['cold turkey'], answer: 'Explanation',
    sections: [{ module: 'usage', content: 'Usage', examples: [example, example] },
      { module: 'examples', content: '', examples: [example, example] }] }
  expect(() => validateExampleCount(card, { count: 2, source: 'default' }, true)).not.toThrow()
  expect(() => validateExampleCount(card, { count: 3, source: 'request' }, true)).toThrow('received 2')
  expect(() => validateExampleCount({ ...card, sections: [] }, { count: 2, source: 'default' }, false)).not.toThrow()
  expect(() => validateExampleCount({ ...card, sections: [] }, { count: 2, source: 'default' }, true)).toThrow('received 0')
  expect(() => validateExampleCount(card, { count: null, source: 'unresolved' }, true)).not.toThrow()
})
