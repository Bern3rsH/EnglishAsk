import { createHash } from 'node:crypto'
import { classificationTags } from '../shared/answer-tags'
import { CardFormatError } from './card-format-error'
import { CardReviewError } from './card-review-error'
import { DEFAULT_ANSWER_LANGUAGE, type AskEnglishResponse } from '../shared/ai'
import { KNOWLEDGE_CARD_CONTEXT_MESSAGE_LIMIT } from '../shared/knowledge-card'
import type { RouterDiagnostic, RouterRoutingInfo } from '../shared/router'
import { buildSystemInstructionWithAnswerLanguage } from './answer-language'
import { validateAskEnglishRequest } from './ai-request'
import { resolveGeminiApiKey } from './api-key'
import { isAbortError } from './ask-cancellation'
import { askProviderText, extractInteractionOutputText } from './provider-adapters'
import { classifyEnglishRequest } from './router-classifier'
import { classifyWithHybridRouter } from './hybrid-router'
import { getJevRoutingConfiguration } from './jev-routing-config'
import { generateKnowledgeCard, getResumableDraftClassification } from './knowledge-card-service'
import {
  getConfiguredModelProvider,
  getConfiguredProviderModel,
  getConfiguredSystemPrompt,
  getEnvironmentProviderApiKey,
  getStoredProviderApiKey
} from './settings'

export { extractInteractionOutputText }

interface AskEnglishOptions {
  includeRouterDiagnostic?: boolean
  signal?: AbortSignal
}

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Router classification failed.'
}

const classifyForRouting = async (
  options: Parameters<typeof classifyEnglishRequest>[0]
): Promise<RouterDiagnostic> => {
  let routing: RouterRoutingInfo | undefined
  try {
    let jevConfiguration: Awaited<ReturnType<typeof getJevRoutingConfiguration>>
    try {
      jevConfiguration = await getJevRoutingConfiguration()
    } catch {
      console.warn('EnglishAsk Jev credentials unavailable; using original routing')
    }
    options.signal?.throwIfAborted()
    const classification = await classifyWithHybridRouter({ ...options, jevConfiguration,
      onRouting: info => { routing = info } })

    console.info('EnglishAsk Router classification', {
      inputType: classification.inputType,
      intent: classification.intent,
      confidence: classification.confidence
    })

    return {
      status: 'success',
      ...(routing ? { routing } : {}),
      classification
    }
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) {
      throw error
    }

    const message = getErrorMessage(error)
    console.warn('EnglishAsk Router diagnostic failed', { message })

    return {
      status: 'error',
      ...(routing ? { routing } : {}),
      message
    }
  }
}

export const askEnglish = async (
  input: unknown,
  options: AskEnglishOptions = {}
): Promise<AskEnglishResponse> => {
  const request = validateAskEnglishRequest(input)
  options.signal?.throwIfAborted()
  const modelProvider = await getConfiguredModelProvider()
  const modelName = await getConfiguredProviderModel(modelProvider)
  const systemPrompt = await getConfiguredSystemPrompt()
  const answerLanguage = DEFAULT_ANSWER_LANGUAGE
  const apiKey = resolveGeminiApiKey(
    await getStoredProviderApiKey(modelProvider),
    getEnvironmentProviderApiKey(modelProvider)
  )

  options.signal?.throwIfAborted()

  if (!apiKey) {
    throw new Error('Add an API key in settings before asking a question.')
  }

  console.info('Sending EnglishAsk request', {
    provider: modelProvider,
    model: modelName,
    answerLanguage,
    questionLength: request.question.length,
    historyCount: request.history.length
  })

  const providerRequest = {
    apiKey,
    modelName,
    modelProvider,
    request,
    ...(options.signal ? { signal: options.signal } : {})
  }
  const retryContextFingerprint = createHash('sha256').update(JSON.stringify({
    question: request.question,
    history: request.history.map(({ role, content }) => ({ role, content })),
    apiKey, modelName, modelProvider, answerLanguage, systemPrompt
  })).digest('hex')
  const resumedClassification = request.retryOfRequestId
    ? getResumableDraftClassification(request.retryOfRequestId, retryContextFingerprint)
    : undefined
  const routerDiagnostic: RouterDiagnostic = resumedClassification
    ? { status: 'success', classification: resumedClassification }
    : await classifyForRouting(providerRequest)
  if (resumedClassification) console.info('EnglishAsk resumed original Router classification for draft review')
  const shouldIncludeRouterDiagnostic =
    options.includeRouterDiagnostic ?? import.meta.env.DEV
  const diagnosticResponse = {
    ...(routerDiagnostic.status === 'success' && routerDiagnostic.classification.responseMode === 'card'
      ? { answerTags: classificationTags(routerDiagnostic.classification.inputType, routerDiagnostic.classification.intent) } : {}),
    ...(shouldIncludeRouterDiagnostic ? { routerDiagnostic } : {}),
    answerLanguage
  }

  if (routerDiagnostic.status === 'success') {
    const { classification } = routerDiagnostic

    if (classification.responseMode === 'clarification') {
      return {
        answer: classification.clarificationQuestion,
        model: modelName,
        ...diagnosticResponse
      }
    }

    if (classification.responseMode === 'card') {
      try {
        // A rejected draft remains readable, but must never become an accepted card.
        const knowledgeCard = await generateKnowledgeCard({
          requestId: request.requestId,
          retryContextFingerprint,
          ...(request.retryOfRequestId ? { retryOfRequestId: request.retryOfRequestId } : {}),
          answerLanguage,
          apiKey,
          modelName,
          modelProvider,
          request: {
            sourceQuestion: request.question,
            recentContext: request.history
              .slice(-KNOWLEDGE_CARD_CONTEXT_MESSAGE_LIMIT)
              .map((message) => ({ role: message.role, content: message.content })),
            classification
          },
          ...(options.signal ? { signal: options.signal } : {})
        })

        return {
          answer: knowledgeCard.answer,
          knowledgeCard,
          model: modelName,
          ...diagnosticResponse
        }
      } catch (error) {
        if (!(error instanceof CardFormatError || error instanceof CardReviewError) || !error.output.trim()) throw error
        options.signal?.throwIfAborted()
        console.warn('EnglishAsk retained unformatted answer', {
          validationError: error instanceof CardReviewError ? error.code
            : error.cause instanceof Error ? error.cause.name : 'UnknownError'
        })
        return {
          answer: error.output,
          formatWarning: error.message,
          warningStage: error instanceof CardReviewError ? 'grammar' : 'format',
          answerLanguage,
          model: modelName,
          ...diagnosticResponse
        }
      }
    }
  }

  const answer = await askProviderText({
    ...providerRequest,
    systemPrompt: buildSystemInstructionWithAnswerLanguage(systemPrompt, answerLanguage)
  })

  return {
    answer,
    model: modelName,
    ...diagnosticResponse
  }
}
