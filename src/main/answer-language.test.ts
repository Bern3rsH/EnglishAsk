import { describe, expect, it } from 'vitest'
import { DEFAULT_ANSWER_LANGUAGE_OPTIONS } from '../shared/ai'
import {
  buildStructuredSystemInstructionWithAnswerLanguage,
  buildSystemInstructionWithAnswerLanguage,
  normalizeDefaultAnswerLanguage,
  resolveQuestionAnswerLanguage
} from './answer-language'

describe('answer language instructions', () => {
  it.each([
    ['Explain ask sb to do sth. Please answer in English.', 'en'],
    ['Can you explain this in English?', 'en'],
    ['Reply only in English, please.', 'en'],
    ['解释 went。请用英文回答。', 'en'],
    ['这次请用英语讲解一下。', 'en'],
    ['Explain went. Please respond in Chinese.', 'zh'],
    ['请用中文解释这个问题。', 'zh'],
    ['请使用简体中文回答。', 'zh'],
    ['Answer in English. Answer in Chinese.', 'zh']
  ] as const)('resolves explicit current-question instruction: %s', (question, expected) => {
    expect(resolveQuestionAnswerLanguage(question, expected === 'en' ? 'zh' : 'en')).toBe(expected)
  })

  it.each([
    ['请用英文解释这个词', 'en'],
    ['用英语讲解一下现在完成时可以吗', 'en'],
    ['请用中文解释这个句子为什么错', 'zh'],
    ['请用英文解释“resilient”这个词', 'en'],
    ['这次中文就好', 'zh'],
    ['本次用英文即可', 'en'],
    ['回答请用中文', 'zh'],
    ['英文回答一下', 'en'],
    ['我想要英文解释', 'en'],
    ['我希望用中文讲解', 'zh'],
    ['Could you explain resilient in English?', 'en'],
    ['Could you explain why this sentence is not correct in English?', 'en'],
    ['Can you explain how to use the present perfect in English?', 'en'],
    ['用英文就好', 'en'],
    ['I’d like an English explanation.', 'en'],
    ['Can you please explain this sentence in simple Chinese?', 'zh'],
    ['Please explain write, wrote and written in English.', 'en'],
    ['Please explain "Do not answer in English" in Chinese.', 'zh'],
    ['Please use English to explain how this pattern works.', 'en'],
    ['Use Chinese for your explanation.', 'zh'],
    ["I'd prefer an English answer.", 'en'],
    ['I would like a Chinese explanation please.', 'zh'],
    ['Your response should be in English.', 'en'],
    ['In English please.', 'en'],
    ['Chinese only.', 'zh'],
    ['Explain resilient, English please.', 'en'],
    ['请用中文解释，例句用英文。', 'zh'],
    ['请用中文回答。This time? English please.', 'en'],
    ['Answer in English, please answer in Chinese.', 'zh']
  ] as const)('recognizes natural preference: %s', (question, expected) => {
    expect(resolveQuestionAnswerLanguage(question, expected === 'en' ? 'zh' : 'en')).toBe(expected)
  })

  it.each([
    'Translate this sentence into English.',
    'Please translate "中文回答" into English.',
    '请把这句话翻译成英文。',
    'Write two examples in English.',
    'Answer only the examples in English.',
    'Please use English only for the examples.',
    'The examples should be in English.',
    '标题用英文就好。',
    '不要用英文解释这个词。',
    'Please do not explain this in English.',
    'Explain this, not in English.',
    'My teacher asked me to answer in English.',
    'Explain why people answer in English.',
    'The phrase "Could you explain this in English?" is polite.',
    '“请用英文解释这个词”是什么意思？',
    '```\nCould you explain this in English?\n```',
    '~~~\nEnglish please.\n~~~',
    'I prefer bilingual answers.',
    'Please explain this in French.'
  ])('does not reinterpret scoped, quoted or reported language as a preference: %s', question => {
    expect(resolveQuestionAnswerLanguage(question, 'zh')).toBe('zh')
    expect(resolveQuestionAnswerLanguage(question, 'en')).toBe('en')
  })

  it.each([
    'Translate "Please answer in English." into Chinese.',
    '解释“请用英文回答。”这句话。',
    'What does `Answer in English` mean?',
    "Translate 'Please answer in English.'",
    '```text\nPlease answer in English.\n```',
    '> Please answer in English.',
    'Give examples in English only.',
    'Only the examples should be in English.',
    'Do not answer in English.',
    '不要用英文回答。',
    'Explain the word English.',
    'Can you explain this in French?',
    '请用中英双语回答。'
  ])('keeps default for learning material, scoped or unsupported requests: %s', question => {
    expect(resolveQuestionAnswerLanguage(question, 'zh')).toBe('zh')
    expect(resolveQuestionAnswerLanguage(question, 'en')).toBe('en')
  })

  it('honors a directive outside a quote without mutating the default', () => {
    expect(resolveQuestionAnswerLanguage('Explain "Answer in Chinese." Please answer in English.', 'zh')).toBe('en')
    expect(resolveQuestionAnswerLanguage('Explain went.', 'zh')).toBe('zh')
  })
  it('offers only Chinese and English answer modes', () => {
    expect(DEFAULT_ANSWER_LANGUAGE_OPTIONS).toEqual([
      { id: 'zh', label: 'Chinese' },
      { id: 'en', label: 'English' }
    ])
  })

  it('uses Chinese instructions while preserving English learning material', () => {
    const instruction = buildSystemInstructionWithAnswerLanguage('Teach English thoroughly.', 'zh')

    expect(instruction).toContain('Answer in Simplified Chinese.')
    expect(instruction).toContain('Keep English examples and corrections in English')
    expect(instruction).toContain(
      'immediately follow every complete English example sentence with its natural Simplified Chinese translation'
    )
  })

  it('requires paired example translations in structured Chinese answer fields', () => {
    const instruction = buildStructuredSystemInstructionWithAnswerLanguage(
      'Return strict JSON only.',
      'zh'
    )

    expect(instruction).toContain(
      'pair every complete English example sentence with its natural Simplified Chinese translation'
    )
    expect(instruction).toContain('separate english and translation fields')
    expect(instruction).toContain('never both in english')
    expect(instruction).toContain('For Markdown-only fields without a paired schema')
    expect(instruction).not.toContain('translation in the same JSON string field')
  })

  it('uses English instructions for structured answer fields', () => {
    const instruction = buildStructuredSystemInstructionWithAnswerLanguage(
      'Return strict JSON only.',
      'en'
    )

    expect(instruction).toContain('write English explanations')
    expect(instruction).not.toContain('Simplified Chinese translation')
  })

  it('migrates the removed bilingual setting to Chinese', () => {
    expect(normalizeDefaultAnswerLanguage('bilingual')).toBe('zh')
  })

  it.each(['en', 'zh', 'unsupported', undefined, null])('uses Chinese for current settings: %s', value => {
    expect(normalizeDefaultAnswerLanguage(value)).toBe('zh')
  })
})
