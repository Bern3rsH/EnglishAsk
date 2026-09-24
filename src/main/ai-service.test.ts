import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./jev-routing-config', () => ({ getJevRoutingConfiguration: vi.fn().mockResolvedValue(undefined) }))
import { getJevRoutingConfiguration } from './jev-routing-config'
import * as hybridRouter from './hybrid-router'
import type { KnowledgeCard } from '../shared/knowledge-card'
import type { RouterClassification } from '../shared/router'
import { askEnglish, extractInteractionOutputText } from './ai-service'
import { generateKnowledgeCard, getResumableDraftClassification } from './knowledge-card-service'
import { GrammarReviewError } from './grammar-review'
import { CardModuleValidationError } from '../shared/card-modules'
import { ExampleValidationError } from '../shared/card-examples'
import { CardFormatError } from './card-format-error'
import { CardReviewError } from './card-review-error'
import { classifyEnglishRequest } from './router-classifier'
import {
  getConfiguredDefaultAnswerLanguage,
  getConfiguredModelProvider,
  getConfiguredProviderModel,
  getConfiguredSystemPrompt,
  getEnvironmentProviderApiKey,
  getStoredProviderApiKey
} from './settings'

const aiSdkMocks = vi.hoisted(() => ({
  chatModel: { modelId: 'gpt-4.1' },
  createOpenAI: vi.fn(),
  generateText: vi.fn(),
  providerChat: vi.fn()
}))

vi.mock('./settings', () => ({
  getConfiguredDefaultAnswerLanguage: vi.fn(),
  getConfiguredModelProvider: vi.fn(),
  getConfiguredProviderModel: vi.fn(),
  getConfiguredSystemPrompt: vi.fn(),
  getEnvironmentProviderApiKey: vi.fn(),
  getStoredProviderApiKey: vi.fn()
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: aiSdkMocks.createOpenAI
}))

vi.mock('ai', () => ({
  generateText: aiSdkMocks.generateText
}))

vi.mock('./router-classifier', () => ({
  classifyEnglishRequest: vi.fn()
}))

vi.mock('./knowledge-card-service', () => ({
  generateKnowledgeCard: vi.fn(),
  getResumableDraftClassification: vi.fn()
}))

const createFetchResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }) as Response

const mockGeminiSettings = (): void => {
  vi.mocked(getConfiguredDefaultAnswerLanguage).mockResolvedValue('en')
  vi.mocked(getConfiguredModelProvider).mockResolvedValue('google-gemini')
  vi.mocked(getConfiguredProviderModel).mockResolvedValue('gemini-3.5-flash')
  vi.mocked(getConfiguredSystemPrompt).mockResolvedValue('Answer clearly.')
  vi.mocked(getEnvironmentProviderApiKey).mockReturnValue(undefined)
  vi.mocked(getStoredProviderApiKey).mockResolvedValue('stored-key')
}

const mockOpenAiSettings = (): void => {
  vi.mocked(getConfiguredDefaultAnswerLanguage).mockResolvedValue('en')
  vi.mocked(getConfiguredModelProvider).mockResolvedValue('openai')
  vi.mocked(getConfiguredProviderModel).mockResolvedValue('gpt-4.1')
  vi.mocked(getConfiguredSystemPrompt).mockResolvedValue('Answer clearly.')
  vi.mocked(getEnvironmentProviderApiKey).mockReturnValue(undefined)
  vi.mocked(getStoredProviderApiKey).mockResolvedValue('openai-key')
}

const routerClassification: RouterClassification = {
  inputType: 'grammar_concept',
  structureType: 'abstract_concept',
  targetText: 'present perfect',
  targets: ['present perfect'],
  focusText: '',
  intent: 'explain_grammar',
  modules: ['meaning', 'grammar', 'usage', 'examples'],
  confidence: 0.94,
  needsClarification: false,
  clarificationQuestion: '',
  responseMode: 'card'
}

const conversationalClassification: RouterClassification = {
  inputType: 'unknown',
  structureType: 'unknown',
  targetText: 'general conversation',
  targets: [],
  focusText: '',
  intent: 'unknown',
  modules: [],
  confidence: 0.91,
  needsClarification: false,
  clarificationQuestion: '',
  responseMode: 'conversational'
}

const knowledgeCard: KnowledgeCard = {
  cardType: 'grammar_concept',
  targetText: 'present perfect',
  targets: ['present perfect'],
  answer: 'The present perfect connects a past action or state with the present.',
  sections: [
    {
      module: 'meaning',
      content: 'Use it when the past event has present relevance.'
    },
    {
      module: 'grammar',
      content: '`have/has + past participle`'
    }
  ]
}

describe('extractInteractionOutputText', () => {
  it('extracts text from the final model output step', () => {
    expect(
      extractInteractionOutputText({
        steps: [
          {
            type: 'model_output',
            content: [{ type: 'text', text: 'Old answer' }]
          },
          {
            type: 'model_output',
            content: [
              { type: 'text', text: 'Final ' },
              { type: 'text', text: 'answer' }
            ]
          }
        ]
      })
    ).toBe('Final answer')
  })
})

describe('askEnglish', () => {
  beforeEach(() => {
    vi.mocked(getJevRoutingConfiguration).mockResolvedValue(undefined)
    vi.mocked(getResumableDraftClassification).mockReset()
    vi.mocked(classifyEnglishRequest).mockResolvedValue(conversationalClassification)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('sends EnglishAsk requests through the Gemini Interactions API', async () => {
    mockGeminiSettings()
    const controller = new AbortController()

    const fetchMock = vi.fn().mockResolvedValue(
      createFetchResponse({
        steps: [
          {
            type: 'model_output',
            content: [{ type: 'text', text: 'Use this sentence.' }]
          }
        ]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      askEnglish(
        {
          requestId: 'request-1',
          question: 'help me',
          history: [
            {
              id: 'message-1',
              role: 'assistant',
              content: 'Previous answer',
              createdAt: '2026-07-04T00:00:00.000Z'
            }
          ]
        },
        { includeRouterDiagnostic: false, signal: controller.signal }
      )
    ).resolves.toEqual({
      answer: 'Use this sentence.',
      answerLanguage: 'zh',
      model: 'gemini-3.5-flash'
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/interactions'
    )

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit
    expect(requestInit.signal).toBe(controller.signal)
    expect(requestInit.method).toBe('POST')
    expect(requestInit.headers).toEqual({
      'Content-Type': 'application/json',
      'x-goog-api-key': 'stored-key'
    })
    expect(JSON.parse(String(requestInit.body))).toEqual({
      model: 'gemini-3.5-flash',
      input: 'Assistant: Previous answer\nUser: help me',
      system_instruction: expect.stringContaining('Answer in Simplified Chinese.'),
      store: false
    })
  })

  it('passes a separate Jev key into live routing without changing the answer provider', async () => {
    mockGeminiSettings()
    vi.mocked(getJevRoutingConfiguration).mockResolvedValue({ channel: 'openrouter', apiKey: 'openrouter-routing-key' })
    const route = vi.spyOn(hybridRouter, 'classifyWithHybridRouter').mockResolvedValue(conversationalClassification)
    const fetchMock = vi.fn().mockResolvedValue(createFetchResponse({ output_text: 'Answer.' }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await askEnglish({ requestId: 'hybrid', question: 'Thanks for your help.', history: [] })
    expect(route).toHaveBeenCalledWith(expect.objectContaining({ jevConfiguration: { channel: 'openrouter', apiKey: 'openrouter-routing-key' },
      apiKey: 'stored-key', modelProvider: 'google-gemini' }))
    expect(response.model).toBe('gemini-3.5-flash')
    expect(fetchMock.mock.calls[0][0]).toContain('generativelanguage.googleapis.com')
  })

  it('uses the saved language without an explicit question directive, ignoring removed legacy overrides', async () => {
    mockGeminiSettings()
    vi.mocked(getConfiguredDefaultAnswerLanguage).mockResolvedValue('zh')

    const fetchMock = vi.fn().mockResolvedValue(
      createFetchResponse({
        output_text: 'Short answer.'
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await askEnglish(
      {
        requestId: 'request-1',
        question: 'Explain this sentence.',
        history: [],
        answerLanguageOverride: 'en'
      },
      { includeRouterDiagnostic: false }
    )

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(requestInit.body)) as Record<string, unknown>

    expect(body.system_instruction).toBe(
      'Answer clearly.\n\nAnswer in Simplified Chinese. Keep English examples and corrections in English when needed. Unless the user explicitly asks for English-only examples, immediately follow every complete English example sentence with its natural Simplified Chinese translation.'
    )
  })

  it('sends OpenAI-compatible providers through the Vercel AI SDK', async () => {
    mockOpenAiSettings()
    const controller = new AbortController()
    aiSdkMocks.providerChat.mockReturnValue(aiSdkMocks.chatModel)
    aiSdkMocks.createOpenAI.mockReturnValue({ chat: aiSdkMocks.providerChat })
    aiSdkMocks.generateText.mockResolvedValue({ text: 'SDK answer.' })

    await expect(
      askEnglish(
        { requestId: 'request-1', question: 'hello there', history: [] },
        { includeRouterDiagnostic: false, signal: controller.signal }
      )
    ).resolves.toEqual({
      answer: 'SDK answer.',
      answerLanguage: 'zh',
      model: 'gpt-4.1'
    })

    expect(aiSdkMocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: 'openai-key',
      name: 'openai'
    })
    expect(aiSdkMocks.providerChat).toHaveBeenCalledWith('gpt-4.1')
    expect(aiSdkMocks.generateText).toHaveBeenCalledWith({
      model: aiSdkMocks.chatModel,
      system: expect.stringContaining('Answer in Simplified Chinese.'),
      prompt: 'User: hello there',
      abortSignal: controller.signal
    })
  })

  it.each([
    { question: 'Could you explain why this sentence is not correct in English?', saved: 'zh', resolved: 'zh' },
    { question: 'Please answer in English.', saved: 'en', resolved: 'zh' },
    { question: '请用中文解释 went 这个词', saved: 'en', resolved: 'zh' }
  ] as const)('uses Chinese despite legacy settings or language requests: $question', async ({ question, saved, resolved }) => {
    mockGeminiSettings()
    vi.mocked(getConfiguredDefaultAnswerLanguage).mockResolvedValue(saved)
    vi.mocked(classifyEnglishRequest).mockResolvedValue(routerClassification)
    vi.mocked(generateKnowledgeCard).mockResolvedValue(knowledgeCard)
    const result = await askEnglish({ requestId: 'language', question, history: [] })
    expect(result.answerLanguage).toBe(resolved)
    expect(generateKnowledgeCard).toHaveBeenCalledWith(expect.objectContaining({ answerLanguage: resolved }))
    expect(classifyEnglishRequest).toHaveBeenCalledTimes(1)
    expect(generateKnowledgeCard).toHaveBeenCalledTimes(1)
    expect(getConfiguredDefaultAnswerLanguage).not.toHaveBeenCalled()
  })

  it('keeps conversational explanations Chinese despite an English-only request', async () => {
    mockGeminiSettings()
    vi.mocked(getConfiguredDefaultAnswerLanguage).mockResolvedValue('zh')
    const fetchMock = vi.fn().mockResolvedValue(createFetchResponse({ output_text: 'Hello.' }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await askEnglish({ requestId: 'language-chat', question: 'Hello there. Please answer in English.', history: [] })
    expect(response.answerLanguage).toBe('zh')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).system_instruction).toContain('Answer in Simplified Chinese.')
  })

  it('includes Gemini Interactions API error messages', async () => {
    mockGeminiSettings()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createFetchResponse(
          {
            error: {
              message: 'API key not valid. Please pass a valid API key.'
            }
          },
          400
        )
      )
    )

    await expect(
      askEnglish(
        { requestId: 'request-1', question: 'hello there', history: [] },
        { includeRouterDiagnostic: false }
      )
    ).rejects.toThrow(
      'Unable to complete the Gemini interaction (400): API key not valid. Please pass a valid API key.'
    )
  })

  it('rejects empty Interactions API responses', async () => {
    mockGeminiSettings()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createFetchResponse({ steps: [] })))

    await expect(
      askEnglish(
        { requestId: 'request-1', question: 'hello there', history: [] },
        { includeRouterDiagnostic: false }
      )
    ).rejects.toThrow('Gemini Interactions API returned an empty response.')
  })

  it('returns a successful conversational Router diagnostic with the normal answer', async () => {
    mockGeminiSettings()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(createFetchResponse({ output_text: 'Conversational answer.' }))
    )

    await expect(
      askEnglish(
        {
          requestId: 'request-1',
          question: 'What can this app do?',
          history: []
        },
        { includeRouterDiagnostic: true }
      )
    ).resolves.toEqual({
      answer: 'Conversational answer.',
      answerLanguage: 'zh',
      model: 'gemini-3.5-flash',
      routerDiagnostic: {
        routing: { source: 'original' },
        status: 'success',
        classification: conversationalClassification
      }
    })

    expect(classifyEnglishRequest).toHaveBeenCalledWith({
      apiKey: 'stored-key',
      modelName: 'gemini-3.5-flash',
      modelProvider: 'google-gemini',
      request: {
        requestId: 'request-1',
        question: 'What can this app do?',
        history: []
      }
    })
  })

  it.each([undefined, 'routing-key'])('routes bare words locally before generating a card (Jev key: %s)', async jevKey => {
    mockGeminiSettings()
    vi.mocked(getJevRoutingConfiguration).mockResolvedValue(jevKey ? { channel: 'openrouter', apiKey: jevKey } : undefined)
    const wordCard = { ...knowledgeCard, cardType: 'word' as const, targetText: 'resilient', targets: ['resilient'] }
    vi.mocked(generateKnowledgeCard).mockResolvedValue(wordCard)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await askEnglish({ requestId: 'local-word', question: 'resilient', history: [] },
      { includeRouterDiagnostic: true })
    expect(response.knowledgeCard).toEqual(wordCard)
    expect(response.routerDiagnostic).toMatchObject({ status: 'success', routing: { source: 'rule' }, classification: {
      inputType: 'word', targetText: 'resilient', modules: ['meaning', 'phonetic', 'usage', 'examples']
    } })
    expect(classifyEnglishRequest).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(generateKnowledgeCard).toHaveBeenCalledTimes(1)
    expect(generateKnowledgeCard).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'stored-key', modelProvider: 'google-gemini'
    }))
  })

  it('returns a structured card as the default answer for a resolved learning target', async () => {
    mockGeminiSettings()
    vi.mocked(classifyEnglishRequest).mockResolvedValue(routerClassification)
    vi.mocked(generateKnowledgeCard).mockResolvedValue(knowledgeCard)

    await expect(
      askEnglish(
        {
          requestId: 'request-1',
          question: 'How do I use the present perfect?',
          history: [
            {
              id: 'message-1',
              role: 'assistant',
              content: 'Earlier context',
              createdAt: '2026-07-29T00:00:00.000Z'
            }
          ]
        },
        { includeRouterDiagnostic: true }
      )
    ).resolves.toEqual({
      answer: knowledgeCard.answer,
      answerLanguage: 'zh',
      answerTags: ['语法概念', '讲解语法'],
      knowledgeCard,
      model: 'gemini-3.5-flash',
      routerDiagnostic: {
        routing: { source: 'original' },
        status: 'success',
        classification: routerClassification
      }
    })

    expect(generateKnowledgeCard).toHaveBeenCalledWith({
      requestId: 'request-1',
      retryContextFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      answerLanguage: 'zh',
      apiKey: 'stored-key',
      modelName: 'gemini-3.5-flash',
      modelProvider: 'google-gemini',
      request: {
        sourceQuestion: 'How do I use the present perfect?',
        recentContext: [
          {
            role: 'assistant',
            content: 'Earlier context'
          }
        ],
        classification: routerClassification
      }
    })
  })

  it('uses the cached route and reports it without rerunning an unstable Router', async () => {
    mockGeminiSettings()
    vi.mocked(getResumableDraftClassification).mockReturnValue(routerClassification)
    vi.mocked(classifyEnglishRequest).mockRejectedValue(new Error('Router unavailable'))
    vi.mocked(generateKnowledgeCard).mockResolvedValue(knowledgeCard)
    const result = await askEnglish({ requestId: 'retry', retryOfRequestId: 'original', question: 'Explain present perfect.', history: [] }, { includeRouterDiagnostic: true })
    expect(classifyEnglishRequest).not.toHaveBeenCalled()
    expect(result.routerDiagnostic).toEqual({ status: 'success', classification: routerClassification })
    expect(generateKnowledgeCard).toHaveBeenCalledWith(expect.objectContaining({
      retryOfRequestId: 'original',
      request: expect.objectContaining({ classification: routerClassification })
    }))
  })

  it.each(['same', 'question', 'context', 'language', 'model', 'provider', 'key', 'prompt'])(
    'checks original inputs before route reuse: %s', async field => {
      mockGeminiSettings()
      vi.mocked(classifyEnglishRequest).mockResolvedValue(routerClassification)
      vi.mocked(generateKnowledgeCard).mockResolvedValue(knowledgeCard)
      const request = { requestId: 'original', question: 'Explain present perfect.', history: [] as import('../shared/ai').ChatMessage[] }
      await askEnglish(request)
      const fingerprint = vi.mocked(generateKnowledgeCard).mock.calls[0][0].retryContextFingerprint
      vi.mocked(getResumableDraftClassification).mockImplementation((id, key) =>
        id === 'original' && key === fingerprint ? routerClassification : undefined)
      if (field === 'question') request.question += ' Give three examples.'
      if (field === 'context') request.history.push({ id: 'context', role: 'user', content: 'Focus on usage.', createdAt: new Date().toISOString() })
      if (field === 'language') vi.mocked(getConfiguredDefaultAnswerLanguage).mockResolvedValue('zh')
      if (field === 'model') vi.mocked(getConfiguredProviderModel).mockResolvedValue('different-model')
      if (field === 'provider') vi.mocked(getConfiguredModelProvider).mockResolvedValue('openai')
      if (field === 'key') vi.mocked(getStoredProviderApiKey).mockResolvedValue('different-key')
      if (field === 'prompt') vi.mocked(getConfiguredSystemPrompt).mockResolvedValue('Different instruction.')
      await askEnglish({ ...request, requestId: 'retry', retryOfRequestId: 'original' })
      expect(classifyEnglishRequest).toHaveBeenCalledTimes(field === 'same' || field === 'language' ? 1 : 2)
    }
  )

  it('returns the Router clarification without generating an answer or card', async () => {
    mockGeminiSettings()
    const clarificationClassification: RouterClassification = {
      ...conversationalClassification,
      confidence: 0.42,
      needsClarification: true,
      clarificationQuestion: '你想了解哪个单词或表达？',
      responseMode: 'clarification'
    }
    vi.mocked(classifyEnglishRequest).mockResolvedValue(clarificationClassification)

    await expect(
      askEnglish(
        { requestId: 'request-1', question: 'What does it mean?', history: [] },
        { includeRouterDiagnostic: true }
      )
    ).resolves.toEqual({
      answer: '你想了解哪个单词或表达？',
      answerLanguage: 'zh',
      model: 'gemini-3.5-flash',
      routerDiagnostic: {
        routing: { source: 'original' },
        status: 'success',
        classification: clarificationClassification
      }
    })

    expect(generateKnowledgeCard).not.toHaveBeenCalled()
  })

  it('shows the original draft with a grammar warning without accepting it or generating another answer', async () => {
    mockGeminiSettings()
    vi.mocked(classifyEnglishRequest).mockResolvedValue(routerClassification)
    const output = JSON.stringify(knowledgeCard)
    vi.mocked(generateKnowledgeCard).mockRejectedValue(new CardReviewError(output, new GrammarReviewError('timeout')))
    const result = await askEnglish({ requestId: 'review-fallback', question: 'Explain went.', history: [] })
    expect(result).toMatchObject({ answer: output, warningStage: 'grammar', formatWarning: expect.stringContaining('[timeout]') })
    expect(result.knowledgeCard).toBeUndefined()
    expect(generateKnowledgeCard).toHaveBeenCalledTimes(1)
  })

  it('does not bypass failed grammar review without a retained draft', async () => {
    mockGeminiSettings()
    vi.mocked(classifyEnglishRequest).mockResolvedValue(routerClassification)
    vi.mocked(generateKnowledgeCard).mockRejectedValue(new GrammarReviewError())
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(askEnglish({
      requestId: 'grammar-review-failure',
      question: 'How do I use the present perfect?',
      history: []
    })).rejects.toBeInstanceOf(GrammarReviewError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['Original Markdown answer', '{"answer":"Original answer","sections":[]}'])(
    'preserves rejected output without accepting a card or making another request: %s', async output => {
    mockGeminiSettings()
    vi.mocked(classifyEnglishRequest).mockResolvedValue(routerClassification)
    vi.mocked(generateKnowledgeCard).mockRejectedValue(new CardFormatError(output, new ExampleValidationError('missing translation.')))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await askEnglish({ requestId: 'format-failure', question: 'Explain went.', history: [] })
    expect(result.answer).toBe(output)
    expect(result.formatWarning).toContain('missing translation')
    expect(result.knowledgeCard).toBeUndefined()
    expect(result.routerDiagnostic?.status).toBe('success')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps empty output as an error rather than showing a blank fallback', async () => {
    mockGeminiSettings()
    vi.mocked(classifyEnglishRequest).mockResolvedValue(routerClassification)
    vi.mocked(generateKnowledgeCard).mockRejectedValue(new CardFormatError(' ', new Error('Invalid JSON')))
    await expect(askEnglish({ requestId: 'empty', question: 'Explain went.', history: [] }))
      .rejects.toBeInstanceOf(CardFormatError)
  })

  it('does not bypass example validation without an original output', async () => {
    mockGeminiSettings()
    vi.mocked(classifyEnglishRequest).mockResolvedValue(routerClassification)
    vi.mocked(generateKnowledgeCard).mockRejectedValue(new ExampleValidationError('missing translation.'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(askEnglish({ requestId: 'example-failure', question: 'Explain went.', history: [] }))
      .rejects.toBeInstanceOf(ExampleValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not bypass missing selected modules with an unstructured fallback', async () => {
    mockGeminiSettings()
    vi.mocked(classifyEnglishRequest).mockResolvedValue(routerClassification)
    vi.mocked(generateKnowledgeCard).mockRejectedValue(new CardModuleValidationError(['usage']))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(askEnglish({ requestId: 'module-failure', question: 'Explain went.', history: [] }))
      .rejects.toMatchObject({ name: 'CardModuleValidationError', missingModules: ['usage'] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['Invalid card JSON.', 'Invalid IPA.', 'Target mismatch.', 'Provider unavailable.'])(
    'does not bypass routed card failure: %s', async message => {
    mockGeminiSettings()
    vi.mocked(classifyEnglishRequest).mockResolvedValue(routerClassification)
    vi.mocked(generateKnowledgeCard).mockRejectedValue(new Error(message))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(createFetchResponse({ output_text: 'Fallback answer.' }))
    )

    await expect(
      askEnglish(
        {
          requestId: 'request-1',
          question: 'How do I use the present perfect?',
          history: []
        },
        { includeRouterDiagnostic: true }
      )
    ).rejects.toThrow(message)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns answer tags even when production Router diagnostics are hidden', async () => {
    mockGeminiSettings()
    vi.mocked(classifyEnglishRequest).mockResolvedValue(routerClassification)
    vi.mocked(generateKnowledgeCard).mockResolvedValue(knowledgeCard)
    const result = await askEnglish({ requestId: 'tagged-answer', question: 'Explain present perfect.', history: [] },
      { includeRouterDiagnostic: false })
    expect(result.answerTags).toEqual(['语法概念', '讲解语法'])
    expect(result.routerDiagnostic).toBeUndefined()
  })

  it('keeps the answer when Router diagnostic classification fails', async () => {
    mockGeminiSettings()
    vi.mocked(classifyEnglishRequest).mockRejectedValue(
      new Error('Router output is not valid JSON.')
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(createFetchResponse({ output_text: 'Normal answer.' }))
    )

    await expect(
      askEnglish(
        { requestId: 'request-1', question: 'hello there', history: [] },
        { includeRouterDiagnostic: true }
      )
    ).resolves.toEqual({
      answer: 'Normal answer.',
      answerLanguage: 'zh',
      model: 'gemini-3.5-flash',
      routerDiagnostic: {
        routing: { source: 'original' },
        status: 'error',
        message: 'Router output is not valid JSON.'
      }
    })
  })

  it('does not fall back to another provider request after Router cancellation', async () => {
    mockGeminiSettings()
    const controller = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(classifyEnglishRequest).mockImplementation(async () => {
      controller.abort()
      throw new Error('Router request interrupted.')
    })

    await expect(
      askEnglish(
        { requestId: 'request-1', question: 'hello there', history: [] },
        { includeRouterDiagnostic: true, signal: controller.signal }
      )
    ).rejects.toThrow('Router request interrupted.')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not use conversational fallback after knowledge-card cancellation', async () => {
    mockGeminiSettings()
    const controller = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(classifyEnglishRequest).mockResolvedValue(routerClassification)
    vi.mocked(generateKnowledgeCard).mockImplementation(async () => {
      controller.abort()
      throw new Error('Card request interrupted.')
    })

    await expect(
      askEnglish(
        {
          requestId: 'request-1',
          question: 'How do I use the present perfect?',
          history: []
        },
        { includeRouterDiagnostic: true, signal: controller.signal }
      )
    ).rejects.toThrow('Card request interrupted.')

    expect(generateKnowledgeCard).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal })
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
