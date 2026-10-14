import { generateMergedJevAnswer } from './merged-jev-answer'
import { createHash } from 'node:crypto'
import { answerFromNotes } from './rag-answer-service'
import { decideNoteAnswerRoute } from './note-answer-routing'
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
  /** Internal experiment switch; production uses the merged path. */
  mergeJevAnswer?: boolean
  includeRouterDiagnostic?: boolean
  signal?: AbortSignal
}

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Router classification failed.'
}

const classifyForRouting = async (
  options: Parameters<typeof classifyEnglishRequest>[0],
  completeAcceptedLabels?: typeof classifyEnglishRequest
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
      completeAcceptedLabels, onRouting: info => { routing = info } })

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
  if (request.answerMode === 'notes') {
    const noteAnswer = await answerFromNotes(request.question, { signal: options.signal })
    return { answer: noteAnswer.answer, noteAnswer, model: noteAnswer.model ?? '', answerLanguage: 'zh' }
  }
  const modelProvider = await getConfiguredModelProvider()
  const modelName = await getConfiguredProviderModel(modelProvider)
  const systemPrompt = await getConfiguredSystemPrompt()
  const answerLanguage = DEFAULT_ANSWER_LANGUAGE
  const apiKey = modelProvider === 'ollama' ? '' : resolveGeminiApiKey(
    await getStoredProviderApiKey(modelProvider),
    getEnvironmentProviderApiKey(modelProvider)
  )

  options.signal?.throwIfAborted()

  if (apiKey === undefined || (modelProvider !== 'ollama' && !apiKey)) {
    throw new Error('Add an API key in settings before asking a question.')
  }

  if (request.answerMode === 'auto') {
    const decision = await decideNoteAnswerRoute(request, { apiKey, modelProvider, modelName, signal: options.signal })
    options.signal?.throwIfAborted()
    console.info('EnglishAsk Notes routing', { route: decision.route, ...decision.routing })
    if (decision.route === 'notes') {
      const noteAnswer = await answerFromNotes(decision.query, { signal: options.signal })
      return { answer: noteAnswer.answer, noteAnswer, model: noteAnswer.model ?? '', answerLanguage: 'zh' }
    }
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
  let mergedAnswer: Awaited<ReturnType<typeof generateMergedJevAnswer>> | undefined
  const routerDiagnostic: RouterDiagnostic = resumedClassification
    ? { status: 'success', classification: resumedClassification }
    : await classifyForRouting(providerRequest, options.mergeJevAnswer === false ? undefined : async completionOptions => {
      const result = await generateMergedJevAnswer({ ...completionOptions, answerLanguage, systemPrompt })
      mergedAnswer = result
      return result.classification
    })
  // A failed or cancelled merged request must never supply an answer to a fallback route.
  if (routerDiagnostic.routing?.source !== 'jev-assisted') mergedAnswer = undefined
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
          ...(mergedAnswer?.initialOutput ? { initialOutput: mergedAnswer.initialOutput } : {}),
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

  const answer = mergedAnswer?.answer ?? await askProviderText({
    ...providerRequest,
    systemPrompt: buildSystemInstructionWithAnswerLanguage(systemPrompt, answerLanguage)
  })

  return {
    answer,
    model: modelName,
    ...diagnosticResponse
  }
}
