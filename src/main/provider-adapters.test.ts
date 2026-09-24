import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  generateProviderText,
  ProviderEmptyResponseError
} from './provider-adapters'

const adapterMocks = vi.hoisted(() => ({
  chatModel: { modelId: 'deepseek-v4-flash' },
  createOpenAI: vi.fn(),
  generateText: vi.fn(),
  jsonOutput: { name: 'json-output' },
  noObjectGeneratedErrorIsInstance: vi.fn(),
  noOutputGeneratedErrorIsInstance: vi.fn(),
  outputJson: vi.fn(),
  providerChat: vi.fn()
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: adapterMocks.createOpenAI
}))

vi.mock('ai', () => ({
  generateText: adapterMocks.generateText,
  NoObjectGeneratedError: {
    isInstance: adapterMocks.noObjectGeneratedErrorIsInstance
  },
  NoOutputGeneratedError: {
    isInstance: adapterMocks.noOutputGeneratedErrorIsInstance
  },
  Output: {
    json: adapterMocks.outputJson
  }
}))

describe('provider adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adapterMocks.createOpenAI.mockReturnValue({ chat: adapterMocks.providerChat })
    adapterMocks.providerChat.mockReturnValue(adapterMocks.chatModel)
    adapterMocks.outputJson.mockReturnValue(adapterMocks.jsonOutput)
    adapterMocks.noObjectGeneratedErrorIsInstance.mockReturnValue(false)
    adapterMocks.noOutputGeneratedErrorIsInstance.mockReturnValue(false)
  })

  it('enables JSON output mode for structured DeepSeek requests', async () => {
    adapterMocks.generateText.mockResolvedValue({
      output: {
        cardType: 'word',
        targetText: 'develop'
      },
      text: ''
    })

    await expect(
      generateProviderText({
        apiKey: 'deepseek-key',
        modelName: 'deepseek-v4-flash',
        modelProvider: 'deepseek',
        prompt: 'Generate a word card.',
        responseFormat: 'json',
        systemPrompt: 'Return strict JSON.'
      })
    ).resolves.toBe('{"cardType":"word","targetText":"develop"}')

    expect(adapterMocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: 'deepseek-key',
      baseURL: 'https://api.deepseek.com/v1',
      name: 'deepseek'
    })
    expect(adapterMocks.outputJson).toHaveBeenCalledTimes(1)
    expect(adapterMocks.generateText).toHaveBeenCalledWith({
      model: adapterMocks.chatModel,
      output: adapterMocks.jsonOutput,
      prompt: 'Generate a word card.',
      system: 'Return strict JSON.'
    })
  })

  it('identifies an empty provider response for selective retries', async () => {
    adapterMocks.generateText.mockResolvedValue({ output: undefined, text: '   ' })

    await expect(
      generateProviderText({
        apiKey: 'deepseek-key',
        modelName: 'deepseek-v4-flash',
        modelProvider: 'deepseek',
        prompt: 'Classify this request.',
        systemPrompt: 'Return a classification.'
      })
    ).rejects.toBeInstanceOf(ProviderEmptyResponseError)
  })

  it.each([
    ['deepseek', 'deepseek-v4-flash', 'grammar-review', true],
    ['deepseek', 'deepseek-v4-pro', 'grammar-review', true],
    ['deepseek', 'deepseek-v4-flash', 'routing', false],
    ['deepseek', 'deepseek-v4-flash', 'card-generation', false],
    ['deepseek', 'deepseek-v4-flash', undefined, false],
    ['deepseek', 'deepseek-reasoner', 'grammar-review', false],
    ['openai', 'gpt-4.1', 'grammar-review', false],
    ['openrouter', 'deepseek/deepseek-v4-flash', 'grammar-review', false]
  ] as const)('scopes review reasoning to supported direct models: %s %s %s', async (modelProvider, modelName, purpose, expected) => {
    adapterMocks.generateText.mockResolvedValue({ output: { corrections: [] }, text: '' })
    await generateProviderText({ apiKey: 'test-key', modelProvider, modelName, purpose,
      prompt: 'Review grammar.', systemPrompt: 'Return JSON.', responseFormat: 'json' })
    expect(adapterMocks.generateText.mock.calls[0][0].providerOptions)
      .toEqual(expected ? { openai: { reasoningEffort: 'none' } } : undefined)
  })

  it('preserves non-empty raw text when structured output parsing fails', async () => {
    const structuredOutputError = {
      text: '  ```json\n{"inputType":"collocation"}\n```  '
    }
    adapterMocks.noObjectGeneratedErrorIsInstance.mockImplementation(
      (error) => error === structuredOutputError
    )
    adapterMocks.generateText.mockRejectedValue(structuredOutputError)

    await expect(
      generateProviderText({
        apiKey: 'deepseek-key',
        modelName: 'deepseek-v4-flash',
        modelProvider: 'deepseek',
        prompt: 'Classify nerve damage.',
        responseFormat: 'json',
        systemPrompt: 'Return strict JSON.'
      })
    ).resolves.toBe('```json\n{"inputType":"collocation"}\n```')
  })
})
