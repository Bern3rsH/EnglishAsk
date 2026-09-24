import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateKnowledgeCardRequest } from '../shared/knowledge-card'
import { PHRASE_PATTERN_CARD_PROMPT } from '../shared/prompt-design'
import type { RouterClassification } from '../shared/router'
import {
  buildKnowledgeCardInput,
  generateKnowledgeCard,
  normalizePhoneticSectionContent,
  parseKnowledgeCard
} from './knowledge-card-service'
import { generateProviderText } from './provider-adapters'
import { GrammarReviewError } from './grammar-review'

vi.mock('./provider-adapters', () => ({
  generateProviderText: vi.fn()
}))

const patternClassification: RouterClassification = {
  inputType: 'pattern',
  structureType: 'pattern',
  targetText: 'ask sb to do',
  targets: ['ask sb to do'],
  focusText: '',
  intent: 'explain_grammar',
  modules: ['meaning', 'grammar', 'examples'],
  confidence: 0.97,
  needsClarification: false,
  clarificationQuestion: '',
  responseMode: 'card'
}

const knowledgeCard = {
  cardType: 'pattern',
  targetText: 'ask somebody to do something',
  targets: ['ask sb to do'],
  answer: 'This pattern means requesting another person to perform an action.',
  sections: [
    {
      module: 'meaning',
      content: 'Use it for a request directed at another person.'
    },
    {
      module: 'grammar',
      content: '`ask + object + to-infinitive`'
    },
    {
      module: 'examples',
      content: '',
      examples: [
        { english: 'She asked me to wait.', translation: '她让我等一下。' },
        { english: 'He asked us to leave.', translation: '他让我们离开。' }
      ]
    }
  ]
} as const

const request: GenerateKnowledgeCardRequest = {
  sourceQuestion: 'How do I use ask sb to do?',
  recentContext: [],
  classification: patternClassification
}

describe('knowledge card generation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('parses a validated card that matches the Router classification', () => {
    expect(parseKnowledgeCard(JSON.stringify(knowledgeCard), patternClassification)).toEqual(
      knowledgeCard
    )
  })

  it('normalizes phonetic content to one fixed UK and US IPA layout', () => {
    expect(normalizePhoneticSectionContent('/dɪˈveləp/')).toBe(
      '- **UK/US:** /dɪˈveləp/'
    )
    expect(
      normalizePhoneticSectionContent(
        'American pronunciation: /təˈmeɪtoʊ/\nBritish pronunciation: /təˈmɑːtəʊ/'
      )
    ).toBe('- **UK:** /təˈmɑːtəʊ/\n- **US:** /təˈmeɪtoʊ/')
  })

  it('rejects a phonetic section without slash-delimited IPA', () => {
    expect(() => normalizePhoneticSectionContent('British pronunciation only')).toThrow(
      'must contain IPA between forward slashes'
    )
  })

  it.each([
    '- **UK/US:** /dɪˈveləp/',
    'UK/US: /dɪˈveləp/',
    'British/American: /dɪˈveləp/',
    '英式/美式: /dɪˈveləp/'
  ])('preserves IPA after a combined accent label: %s', (content) => {
    expect(normalizePhoneticSectionContent(content)).toBe('- **UK/US:** /dɪˈveləp/')
  })

  it.each([
    '- **UK/US:** /dɪˈveləp/',
    '- **UK:** /təˈmɑːtəʊ/\n- **US:** /təˈmeɪtoʊ/',
    '- **UK:** /dɪˈveləp/\n- **US:** /dɪˈveləp/'
  ])('does not damage IPA when normalizing repeatedly: %s', (content) => {
    const normalized = normalizePhoneticSectionContent(content)
    expect(normalizePhoneticSectionContent(normalized)).toBe(normalized)
  })

  it.each(['- **UK/US:** /US:** /', 'UK/US', '/.../']) (
    'rejects markup fragments and placeholders instead of treating them as IPA: %s',
    (content) => {
      expect(() => normalizePhoneticSectionContent(content)).toThrow(
        'must contain IPA between forward slashes'
      )
    }
  )

  it('preserves the English IPA in a Chinese-to-English translation card', async () => {
    const classification: RouterClassification = {
      ...patternClassification,
      inputType: 'word',
      structureType: 'single_word',
      targetText: '药物',
      targets: ['药物'],
      intent: 'translate',
      modules: ['translation', 'phonetic']
    }
    vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify({
      cardType: 'word',
      targetText: '药物',
      targets: ['药物'],
      answer: '药物可以译为 medicine。',
      sections: [
        { module: 'translation', content: 'medicine' },
        { module: 'phonetic', content: '- **UK/US:** /ˈmedɪsɪn/' }
      ]
    }))

    const card = await generateKnowledgeCard({
      answerLanguage: 'zh',
      apiKey: 'test-key',
      modelName: 'test-model',
      modelProvider: 'openai',
      request: { sourceQuestion: '药物', recentContext: [], classification }
    })

    expect(card.sections).toEqual([
      { module: 'phonetic', content: '- **UK/US:** /ˈmedɪsɪn/' },
      { module: 'translation', content: 'medicine' }
    ])
  })

  it('rejects mismatched targets', () => {
    expect(() =>
      parseKnowledgeCard(
        JSON.stringify({
          ...knowledgeCard,
          targets: ['tell sb to do']
        }),
        patternClassification
      )
    ).toThrow('targets do not match')
  })

  it('projects sections onto Router membership and canonical type order', () => {
    expect(
      parseKnowledgeCard(
        JSON.stringify({
          ...knowledgeCard,
          sections: [
            knowledgeCard.sections[2],
            {
              module: 'translation',
              content: '要求某人做某事'
            },
            knowledgeCard.sections[0],
            knowledgeCard.sections[0],
            knowledgeCard.sections[1]
          ]
        }),
        patternClassification
      ).sections
    ).toEqual(knowledgeCard.sections)
  })

  it('builds a card request from Router, source, context, and answer-language data', () => {
    expect(JSON.parse(buildKnowledgeCardInput(request, 'zh'))).toEqual({
      router: patternClassification,
      sourceQuestion: request.sourceQuestion,
      recentContext: [],
      settings: {
        answerLanguage: 'zh',
        requireExampleTranslations: true,
        exampleCount: { count: 2, source: 'default' }
      }
    })
  })

  it('selects the route-specific Card Prompt and returns the generated card', async () => {
    vi.mocked(generateProviderText)
      .mockResolvedValueOnce(JSON.stringify(knowledgeCard))
      .mockResolvedValueOnce(JSON.stringify({ corrections: [] }))

    await expect(
      generateKnowledgeCard({
        answerLanguage: 'zh',
        apiKey: 'stored-key',
        modelName: 'gpt-4.1',
        modelProvider: 'openai',
        request
      })
    ).resolves.toEqual(knowledgeCard)

    expect(generateProviderText).toHaveBeenCalledWith({
      apiKey: 'stored-key',
      modelName: 'gpt-4.1',
      modelProvider: 'openai',
      prompt: buildKnowledgeCardInput(request, 'zh'),
      purpose: 'card-generation',
      responseFormat: 'json',
      systemPrompt: expect.stringContaining(PHRASE_PATTERN_CARD_PROMPT)
    })
    expect(generateProviderText).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(
          'pair every complete English example sentence with its natural Simplified Chinese translation'
        )
      })
    )
    expect(generateProviderText).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('first line "- **UK:** /.../"')
      })
    )
    expect(generateProviderText).toHaveBeenCalledTimes(2)
  })

  it('returns only the repaired card from the complete generation pipeline', async () => {
    const draft = {
      ...knowledgeCard,
      sections: [{ module: 'grammar', content: 'sb is the indirect object.' }, knowledgeCard.sections[2]]
    }
    vi.mocked(generateProviderText)
      .mockResolvedValueOnce(JSON.stringify(draft))
      .mockResolvedValueOnce(JSON.stringify({ corrections: [{
        field: 'grammar', quote: 'sb is the indirect object.',
        reason: 'This is not a double-object pattern.',
        replacement: 'sb is the object of ask in ask + object + to-infinitive.'
      }] }))
    const card = await generateKnowledgeCard({
      answerLanguage: 'en', apiKey: 'test-key', modelName: 'test-model',
      modelProvider: 'openai', request: { ...request,
        classification: { ...patternClassification, modules: ['grammar', 'examples'] } }
    })
    expect(card.sections[0].content).toBe('sb is the object of ask in ask + object + to-infinitive.')
    expect(card.sections[1]).toEqual(knowledgeCard.sections[2])
    expect(generateProviderText).toHaveBeenCalledTimes(2)
  })

  it.each(['Original Markdown answer', '{"answer":"truncated', '```json\n{}\n```'])(
    'preserves malformed generated output without calling review: %s', async output => {
    vi.mocked(generateProviderText).mockResolvedValueOnce(output)
    await expect(generateKnowledgeCard({
      answerLanguage: 'zh', apiKey: 'test-key', modelName: 'test-model',
      modelProvider: 'openai', request
    })).rejects.toMatchObject({ name: 'CardFormatError', output })
    expect(generateProviderText).toHaveBeenCalledTimes(1)
  })

  it('rejects missing translations before grammar review', async () => {
    vi.mocked(generateProviderText).mockResolvedValueOnce(JSON.stringify({
      ...knowledgeCard,
      sections: [{ module: 'examples', content: '', examples: [{ english: 'She asked me to wait.' }] }]
    }))
    await expect(generateKnowledgeCard({
      answerLanguage: 'zh', apiKey: 'test-key', modelName: 'test-model',
      modelProvider: 'openai', request
    })).rejects.toThrow('Chinese answers require a Chinese translation')
    expect(generateProviderText).toHaveBeenCalledTimes(1)
  })

  it('revalidates paired translations after grammar review', async () => {
    vi.mocked(generateProviderText)
      .mockResolvedValueOnce(JSON.stringify(knowledgeCard))
      .mockResolvedValueOnce(JSON.stringify({ corrections: [{
        field: 'examples.examples.0.translation', quote: '她让我等一下。',
        reason: 'Test an invalid translation replacement.', replacement: 'She asked me to wait.'
      }] }))
    await expect(generateKnowledgeCard({
      answerLanguage: 'zh', apiKey: 'test-key', modelName: 'test-model',
      modelProvider: 'openai', request
    })).rejects.toMatchObject({ code: 'invalid_reviewed_card', output: JSON.stringify(knowledgeCard) })
    expect(generateProviderText).toHaveBeenCalledTimes(2)
  })

  it.each(['timeout', 'network_failed', 'invalid_json', 'quote_mismatch'] as const)(
    'retains the original draft and resumes only review after %s', async code => {
    const output = JSON.stringify(knowledgeCard)
    vi.mocked(generateProviderText).mockResolvedValueOnce(output)
      .mockRejectedValueOnce(new GrammarReviewError(code))
      .mockResolvedValueOnce(JSON.stringify({ corrections: [] }))
    const options = {
      answerLanguage: 'zh' as const, apiKey: 'test-key', modelName: 'test-model',
      modelProvider: 'openai' as const, request, requestId: `review-fallback-${code}`
    }
    await expect(generateKnowledgeCard(options)).rejects.toMatchObject({ code, output })
    const recovered = await generateKnowledgeCard({ ...options,
      requestId: `review-retry-${code}`, retryOfRequestId: options.requestId })
    expect(recovered.answer).toBe(knowledgeCard.answer)
    expect(vi.mocked(generateProviderText).mock.calls.map(([call]) => call.purpose))
      .toEqual(['card-generation', 'grammar-review', 'grammar-review'])
  })

  it.each([1, 3])('rejects a default example count of %s before review', async count => {
    vi.mocked(generateProviderText).mockResolvedValueOnce(JSON.stringify({
      ...knowledgeCard,
      sections: [{ module: 'examples', content: '', examples: Array.from({ length: count }, () => knowledgeCard.sections[2].examples[0]) }]
    }))
    await expect(generateKnowledgeCard({
      answerLanguage: 'zh', apiKey: 'test-key', modelName: 'test-model',
      modelProvider: 'openai', request
    })).rejects.toThrow(`expected 2 examples in the examples module; received ${count}`)
    expect(generateProviderText).toHaveBeenCalledTimes(1)
  })

  it('allows an explicit count to override the default through generation and review', async () => {
    const draft = { ...knowledgeCard, sections: [{ module: 'examples', content: '', examples: [knowledgeCard.sections[2].examples[0]] }] }
    vi.mocked(generateProviderText)
      .mockResolvedValueOnce(JSON.stringify(draft))
      .mockResolvedValueOnce(JSON.stringify({ corrections: [] }))
    await expect(generateKnowledgeCard({
      answerLanguage: 'zh', apiKey: 'test-key', modelName: 'test-model', modelProvider: 'openai',
      request: { ...request, sourceQuestion: 'Give one example of ask sb to do.',
        classification: { ...patternClassification, modules: ['examples'] } }
    })).resolves.toEqual(draft)
  })

  it('requires the default examples module when Router leaves modules empty', async () => {
    vi.mocked(generateProviderText).mockResolvedValueOnce(JSON.stringify({
      ...knowledgeCard, sections: [knowledgeCard.sections[0]]
    }))
    await expect(generateKnowledgeCard({
      answerLanguage: 'zh', apiKey: 'test-key', modelName: 'test-model', modelProvider: 'openai',
      request: { ...request, classification: { ...patternClassification, modules: [] } }
    })).rejects.toThrow('requested examples module is missing')
    expect(generateProviderText).toHaveBeenCalledTimes(1)
  })

  it('rejects missing selected modules before grammar review', async () => {
    vi.mocked(generateProviderText).mockResolvedValueOnce(JSON.stringify(knowledgeCard))
    await expect(generateKnowledgeCard({
      answerLanguage: 'zh', apiKey: 'test-key', modelName: 'test-model', modelProvider: 'openai',
      request: { ...request, classification: { ...patternClassification, modules: ['meaning', 'grammar', 'usage', 'examples'] } }
    })).rejects.toMatchObject({ name: 'CardFormatError', output: JSON.stringify(knowledgeCard),
      cause: { name: 'CardModuleValidationError', missingModules: ['usage'] } })
    expect(generateProviderText).toHaveBeenCalledTimes(1)
  })

  it('rejects unresolved Router classifications before calling a model', async () => {
    await expect(
      generateKnowledgeCard({
        answerLanguage: 'zh',
        apiKey: 'stored-key',
        modelName: 'gpt-4.1',
        modelProvider: 'openai',
        request: {
          ...request,
          classification: {
            ...patternClassification,
            inputType: 'unknown',
            structureType: 'unknown',
            targets: [],
            needsClarification: true,
            clarificationQuestion: 'Which expression should be explained?',
            responseMode: 'clarification'
          }
        }
      })
    ).rejects.toThrow('Router classification must use card responseMode')

    expect(generateProviderText).not.toHaveBeenCalled()
  })
})
