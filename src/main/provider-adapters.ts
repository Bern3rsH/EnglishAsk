import { createOpenAI } from '@ai-sdk/openai'
import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output
} from 'ai'
import type { AskEnglishRequest, ModelProvider } from '../shared/ai'
import { buildEnglishAskPrompt } from './ai-request'
import { measureModelRequest, type ModelRequestPurpose } from './request-timing'
import { fetchNativeProviderJSON, isRecord, nativeProviderHeaders } from './native-provider-api'

const GEMINI_INTERACTIONS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const CONTENT_TYPE_HEADER = 'Content-Type'
const GEMINI_API_KEY_HEADER = 'x-goog-api-key'
const JSON_CONTENT_TYPE = 'application/json'
const ANTHROPIC_MAX_OUTPUT_TOKENS = 16_384

const OPENAI_COMPATIBLE_PROVIDERS = {
  openai: {
    name: 'openai'
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com/v1',
    name: 'deepseek'
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    name: 'openrouter'
  }
} as const

interface AskProviderTextOptions {
  apiKey: string
  modelName: string
  modelProvider: ModelProvider
  request: AskEnglishRequest
  signal?: AbortSignal
  systemPrompt: string
}

export interface GenerateProviderTextOptions {
  apiKey: string
  modelName: string
  modelProvider: ModelProvider
  prompt: string
  responseFormat?: 'json'
  purpose?: ModelRequestPurpose
  signal?: AbortSignal
  systemPrompt: string
}

export class ProviderEmptyResponseError extends Error {
  constructor(providerName: string) {
    super(`${providerName} returned an empty response.`)
    this.name = 'ProviderEmptyResponseError'
  }
}

interface GeminiTextContent {
  type?: string
  text?: string
}

interface GeminiInteractionStep {
  type?: string
  content?: GeminiTextContent[]
}

interface GeminiInteractionResponse {
  output_text?: string
  steps?: GeminiInteractionStep[]
}

interface GeminiInteractionErrorResponse {
  error?: {
    message?: string
  }
}

const isTextContent = (content: GeminiTextContent): boolean => {
  return content.type === 'text' && typeof content.text === 'string'
}

export const extractInteractionOutputText = (interaction: GeminiInteractionResponse): string => {
  if (typeof interaction.output_text === 'string' && interaction.output_text.trim().length > 0) {
    return interaction.output_text.trim()
  }

  const modelOutputStep = [...(interaction.steps ?? [])]
    .reverse()
    .find((step) => step.type === 'model_output')
  const outputText =
    modelOutputStep?.content
      ?.filter(isTextContent)
      .map((content) => content.text)
      .join('') ?? ''

  return outputText.trim()
}

const getInteractionErrorMessage = async (response: Response): Promise<string> => {
  try {
    const data = (await response.json()) as GeminiInteractionErrorResponse
    const message = data.error?.message?.trim()

    if (message) {
      return `Unable to complete the Gemini interaction (${response.status}): ${message}`
    }
  } catch {
    return `Unable to complete the Gemini interaction (${response.status}).`
  }

  return `Unable to complete the Gemini interaction (${response.status}).`
}

const generateGeminiText = async (options: GenerateProviderTextOptions): Promise<string> => {
  const response = await fetch(GEMINI_INTERACTIONS_ENDPOINT, {
    method: 'POST',
    headers: {
      [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE,
      [GEMINI_API_KEY_HEADER]: options.apiKey
    },
    body: JSON.stringify({
      model: options.modelName,
      input: options.prompt,
      system_instruction: options.systemPrompt,
      store: false
    }),
    ...(options.signal ? { signal: options.signal } : {})
  })

  if (!response.ok) {
    throw new Error(await getInteractionErrorMessage(response))
  }

  const interaction = (await response.json()) as GeminiInteractionResponse
  const answer = extractInteractionOutputText(interaction)

  if (answer.length === 0) {
    throw new ProviderEmptyResponseError('Gemini Interactions API')
  }

  return answer
}

const generateOpenAiCompatibleText = async (
  options: GenerateProviderTextOptions
): Promise<string> => {
  if (options.modelProvider === 'google-gemini' || options.modelProvider === 'anthropic') {
    throw new Error('Unsupported OpenAI-compatible provider.')
  }
  const providerConfig = OPENAI_COMPATIBLE_PROVIDERS[options.modelProvider]
  const provider = createOpenAI({
    apiKey: options.apiKey,
    ...('baseURL' in providerConfig ? { baseURL: providerConfig.baseURL } : {}),
    name: providerConfig.name
  })
  try {
    const result = await generateText({
      model: provider.chat(options.modelName),
      system: options.systemPrompt,
      prompt: options.prompt,
      ...(options.purpose === 'grammar-review' && options.modelProvider === 'deepseek' &&
        /^deepseek-v4-(flash|pro)$/.test(options.modelName)
        ? { providerOptions: { openai: { reasoningEffort: 'none' } } } : {}),
      ...(options.responseFormat === 'json' ? { output: Output.json() } : {}),
      ...(options.signal ? { abortSignal: options.signal } : {})
    })
    const answer =
      options.responseFormat === 'json'
        ? JSON.stringify(result.output)
        : result.text.trim()

    if (answer.length === 0) {
      throw new ProviderEmptyResponseError(providerConfig.name)
    }

    return answer
  } catch (error) {
    if (
      options.responseFormat === 'json' &&
      NoObjectGeneratedError.isInstance(error) &&
      error.text !== undefined &&
      error.text.trim().length > 0
    ) {
      return error.text.trim()
    }

    const isEmptyStructuredResponse =
      options.responseFormat === 'json' &&
      (NoOutputGeneratedError.isInstance(error) ||
        (NoObjectGeneratedError.isInstance(error) &&
          (error.text === undefined || error.text.trim().length === 0)))

    if (isEmptyStructuredResponse) {
      throw new ProviderEmptyResponseError(providerConfig.name)
    }

    throw error
  }
}

const generateAnthropicText = async (options: GenerateProviderTextOptions): Promise<string> => {
  const response = await fetchNativeProviderJSON('anthropic', 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { ...nativeProviderHeaders('anthropic', options.apiKey), 'Content-Type': JSON_CONTENT_TYPE },
    body: JSON.stringify({
      model: options.modelName,
      max_tokens: ANTHROPIC_MAX_OUTPUT_TOKENS,
      system: options.systemPrompt + (options.responseFormat === 'json'
        ? '\nReturn only one valid JSON object, without Markdown fences or surrounding text.' : ''),
      messages: [{ role: 'user', content: options.prompt }]
    }),
    ...(options.signal ? { signal: options.signal } : {})
  })
  if (!isRecord(response) || !Array.isArray(response.content)) {
    throw new Error('Anthropic response format is invalid.')
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Claude 回答超出输出上限，请缩小问题或笔记范围后重试。')
  }
  const answer = response.content
    .filter(block => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text).join('').trim()
  if (!answer) throw new ProviderEmptyResponseError('Anthropic')
  return answer
}

export const generateProviderText = async (
  options: GenerateProviderTextOptions
): Promise<string> => {
  return measureModelRequest({ purpose: options.purpose ?? 'answer',
    modelProvider: options.modelProvider, modelName: options.modelName, signal: options.signal },
  () => options.modelProvider === 'google-gemini'
    ? generateGeminiText(options)
    : options.modelProvider === 'anthropic'
      ? generateAnthropicText(options) : generateOpenAiCompatibleText(options))
}

export const askProviderText = async (options: AskProviderTextOptions): Promise<string> => {
  return generateProviderText({
    apiKey: options.apiKey,
    modelName: options.modelName,
    modelProvider: options.modelProvider,
    prompt: buildEnglishAskPrompt(options.request),
    ...(options.signal ? { signal: options.signal } : {}),
    systemPrompt: options.systemPrompt
  })
}
