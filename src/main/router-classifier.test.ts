import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ROUTER_CLASSIFIER_PROMPT } from '../shared/prompt-design'
import { classifyEnglishRequest, parseRouterClassification } from './router-classifier'
import {
  generateProviderText,
  ProviderEmptyResponseError
} from './provider-adapters'

vi.mock('./provider-adapters', () => {
  class MockProviderEmptyResponseError extends Error {}

  return {
    generateProviderText: vi.fn(),
    ProviderEmptyResponseError: MockProviderEmptyResponseError
  }
})

const comparisonClassification = {
  inputType: 'comparison',
  structureType: 'multi_target_comparison',
  targetText: 'say vs tell',
  targets: ['say', 'tell'],
  focusText: '',
  intent: 'compare_difference',
  modules: ['comparison', 'usage', 'examples'],
  confidence: 0.96,
  needsClarification: false,
  clarificationQuestion: '',
  responseMode: 'card'
}

describe('Router classification parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses a valid strict JSON classification', () => {
    expect(parseRouterClassification(JSON.stringify(comparisonClassification))).toEqual(
      comparisonClassification
    )
  })

  it('accepts a JSON code fence while preserving the classification contract', () => {
    const fencedOutput = `\`\`\`json
${JSON.stringify(comparisonClassification)}
\`\`\``

    expect(parseRouterClassification(fencedOutput)).toEqual(comparisonClassification)
  })

  it('extracts a valid classification when the model surrounds JSON with reasoning text', () => {
    const windDownClassification = {
      inputType: 'phrase',
      structureType: 'fixed_expression',
      targetText: 'wind down',
      targets: ['wind down'],
      focusText: '',
      intent: 'explain_meaning',
      modules: ['meaning', 'usage', 'examples'],
      confidence: 0.97,
      needsClarification: false,
      clarificationQuestion: '',
      responseMode: 'card'
    }
    const wrappedOutput = `<think>I should return the requested object. A brace inside a string such as "{}" must not end extraction.</think>
${JSON.stringify(windDownClassification)}
This is the classification.`

    expect(parseRouterClassification(wrappedOutput)).toEqual(windDownClassification)
  })

  it('skips an unrelated JSON object before a valid Router classification', () => {
    const wrappedOutput = `Metadata: {"attempt":1}
${JSON.stringify(comparisonClassification)}`

    expect(parseRouterClassification(wrappedOutput)).toEqual(comparisonClassification)
  })

  it('normalizes omitted optional text for a single-word route', () => {
    const turkeyClassification = {
      inputType: 'word',
      structureType: 'single_word',
      targetText: 'turkey',
      targets: ['turkey'],
      intent: 'explain_meaning',
      modules: ['meaning', 'phonetic', 'usage', 'examples'],
      confidence: 0.95,
      needsClarification: false,
      responseMode: 'card'
    }

    expect(
      parseRouterClassification(
        JSON.stringify({
          ...turkeyClassification,
          focusText: null,
          clarificationQuestion: null
        })
      )
    ).toEqual({
      ...turkeyClassification,
      focusText: '',
      clarificationQuestion: ''
    })

    expect(parseRouterClassification(JSON.stringify(turkeyClassification))).toEqual({
      ...turkeyClassification,
      focusText: '',
      clarificationQuestion: ''
    })
  })

  it('rejects unsupported routes, duplicate modules, and invalid confidence', () => {
    expect(() =>
      parseRouterClassification(
        JSON.stringify({
          ...comparisonClassification,
          inputType: 'vocabulary'
        })
      )
    ).toThrow('invalid inputType')

    expect(() =>
      parseRouterClassification(
        JSON.stringify({
          ...comparisonClassification,
          modules: ['comparison', 'comparison']
        })
      )
    ).toThrow('duplicate modules')

    expect(() =>
      parseRouterClassification(
        JSON.stringify({
          ...comparisonClassification,
          confidence: 1.1
        })
      )
    ).toThrow('between 0 and 1')
  })

  it('requires two distinct targets for a resolved comparison route', () => {
    expect(() =>
      parseRouterClassification(
        JSON.stringify({
          ...comparisonClassification,
          targets: ['say']
        })
      )
    ).toThrow('at least two distinct targets')
  })

  it('requires responseMode to match the clarification state', () => {
    expect(() =>
      parseRouterClassification(
        JSON.stringify({
          ...comparisonClassification,
          needsClarification: true,
          clarificationQuestion: 'Which terms should be compared?'
        })
      )
    ).toThrow('responseMode does not match')

    expect(() =>
      parseRouterClassification(
        JSON.stringify({
          ...comparisonClassification,
          inputType: 'unknown',
          structureType: 'unknown',
          responseMode: 'card'
        })
      )
    ).toThrow('Unknown Router input cannot use card')
  })

  it('allows conversational requests without a learning target', () => {
    const conversationalClassification = {
      ...comparisonClassification,
      inputType: 'unknown',
      structureType: 'unknown',
      targetText: '',
      targets: [],
      intent: 'unknown',
      modules: [],
      responseMode: 'conversational'
    }

    expect(
      parseRouterClassification(JSON.stringify(conversationalClassification))
    ).toEqual(conversationalClassification)
  })

  it('uses the Router system prompt and current conversation as classifier input', async () => {
    vi.mocked(generateProviderText).mockResolvedValue(
      JSON.stringify(comparisonClassification)
    )

    await expect(
      classifyEnglishRequest({
        apiKey: 'test-key',
        modelName: 'test-model',
        modelProvider: 'openai',
        request: {
          requestId: 'request-1',
          question: 'What is the difference?',
          history: [
            {
              id: 'message-1',
              role: 'user',
              content: 'Compare say and tell.',
              createdAt: '2026-07-29T00:00:00.000Z'
            }
          ]
        }
      })
    ).resolves.toEqual(comparisonClassification)

    expect(generateProviderText).toHaveBeenCalledWith({
      apiKey: 'test-key',
      modelName: 'test-model',
      modelProvider: 'openai',
      prompt: 'User: Compare say and tell.\nUser: What is the difference?',
      purpose: 'routing',
      responseFormat: 'json',
      systemPrompt: ROUTER_CLASSIFIER_PROMPT
    })
  })

  it('preserves Jev labels while completing the remaining Router fields', async () => {
    vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify(comparisonClassification))
    const requiredLabels = { inputType: 'comparison', structureType: 'multi_target_comparison',
      intent: 'compare_difference', responseMode: 'card' } as const
    const result = await classifyEnglishRequest({ apiKey: 'key', modelName: 'model', modelProvider: 'deepseek',
      request: { requestId: 'jev', question: 'say vs tell', history: [] }, requiredLabels })
    expect(result).toEqual(comparisonClassification)
    expect(vi.mocked(generateProviderText).mock.calls[0][0].systemPrompt).toContain(JSON.stringify(requiredLabels))
  })

  it('rejects completion that changes the Jev labels after the bounded retry', async () => {
    vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify(comparisonClassification))
    await expect(classifyEnglishRequest({ apiKey: 'key', modelName: 'model', modelProvider: 'deepseek',
      request: { requestId: 'jev', question: 'say vs tell', history: [] },
      requiredLabels: { inputType: 'word', structureType: 'single_word', intent: 'explain_meaning', responseMode: 'card' }
    })).rejects.toThrow('did not preserve')
    expect(generateProviderText).toHaveBeenCalledTimes(2)
  })

  it('retries one empty Router response before returning the classification', async () => {
    vi.mocked(generateProviderText)
      .mockRejectedValueOnce(new ProviderEmptyResponseError('deepseek'))
      .mockResolvedValueOnce(JSON.stringify(comparisonClassification))

    await expect(
      classifyEnglishRequest({
        apiKey: 'test-key',
        modelName: 'deepseek-v4-flash',
        modelProvider: 'deepseek',
        request: {
          requestId: 'request-1',
          question: 'cold turkey',
          history: []
        }
      })
    ).resolves.toEqual(comparisonClassification)

    expect(generateProviderText).toHaveBeenCalledTimes(2)
  })

  it('retries malformed Router JSON for nerve damage with a correction instruction', async () => {
    const nerveDamageClassification = {
      inputType: 'collocation',
      structureType: 'collocation',
      targetText: 'nerve damage',
      targets: ['nerve damage'],
      focusText: '',
      intent: 'explain_meaning',
      modules: ['meaning', 'usage', 'collocations', 'examples'],
      confidence: 0.96,
      needsClarification: false,
      clarificationQuestion: '',
      responseMode: 'card'
    }
    vi.mocked(generateProviderText)
      .mockResolvedValueOnce('I cannot return the requested JSON.')
      .mockResolvedValueOnce(JSON.stringify(nerveDamageClassification))

    await expect(
      classifyEnglishRequest({
        apiKey: 'test-key',
        modelName: 'deepseek-v4-flash',
        modelProvider: 'deepseek',
        request: {
          requestId: 'request-1',
          question: 'nerve damage',
          history: []
        }
      })
    ).resolves.toEqual(nerveDamageClassification)

    expect(generateProviderText).toHaveBeenCalledTimes(2)
    expect(generateProviderText).toHaveBeenLastCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(
          'The previous Router output was empty or invalid.'
        )
      })
    )
  })

  it('does not retry unrelated provider failures', async () => {
    vi.mocked(generateProviderText).mockRejectedValue(new Error('Provider rate limit exceeded.'))

    await expect(
      classifyEnglishRequest({
        apiKey: 'test-key',
        modelName: 'deepseek-v4-flash',
        modelProvider: 'deepseek',
        request: {
          requestId: 'request-1',
          question: 'nerve damage',
          history: []
        }
      })
    ).rejects.toThrow('Provider rate limit exceeded.')

    expect(generateProviderText).toHaveBeenCalledTimes(1)
  })
})
