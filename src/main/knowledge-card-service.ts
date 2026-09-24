import { createHash } from 'node:crypto'
import { CardFormatError } from './card-format-error'
import { CardReviewError } from './card-review-error'
import { isAbortError } from './ask-cancellation'
import { ReviewDraftCache } from './review-draft-cache'
import {
  KNOWLEDGE_CARD_CONTEXT_MESSAGE_LIMIT,
  KNOWLEDGE_CARD_TYPES,
  type GenerateKnowledgeCardRequest,
  type KnowledgeCard,
  type KnowledgeCardContextMessage,
  type KnowledgeCardSection,
  type KnowledgeCardType
} from '../shared/knowledge-card'
import type { DefaultAnswerLanguage, ModelProvider } from '../shared/ai'
import {
  COMPARISON_CARD_PROMPT,
  GRAMMAR_CONCEPT_CARD_PROMPT,
  PHRASE_PATTERN_CARD_PROMPT,
  SENTENCE_CARD_PROMPT,
  WORD_CARD_PROMPT
} from '../shared/prompt-design'
import {
  ROUTER_MODULES,
  type RouterClassification,
  type RouterModule
} from '../shared/router'
import { generateProviderText } from './provider-adapters'
import { validateRouterClassification } from './router-classifier'
import { buildStructuredSystemInstructionWithAnswerLanguage } from './answer-language'
import { GrammarReviewError, reviewGrammar } from './grammar-review'
import { ExampleValidationError, parseCardExamples, requiresExampleTranslations, validateGeneratedExamples } from '../shared/card-examples'
import { resolveExampleCount, validateExampleCount } from '../shared/example-count'
import { CardModuleValidationError, getCardModuleOrder, getSelectedCardModules, validateGeneratedCardModules } from '../shared/card-modules'

export const MAX_KNOWLEDGE_CARD_CONTENT_CHARACTERS = 20_000
export const MAX_KNOWLEDGE_CARD_CONTEXT_CHARACTERS = 4_000

interface GenerateKnowledgeCardOptions {
  requestId?: string
  retryOfRequestId?: string
  retryContextFingerprint?: string
  answerLanguage: DefaultAnswerLanguage
  apiKey: string
  modelName: string
  modelProvider: ModelProvider
  request: unknown
  signal?: AbortSignal
}

const JSON_CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i
const reviewDraftCache = new ReviewDraftCache()
export const getResumableDraftClassification = (
  requestId: string, fingerprint: string
): RouterClassification | undefined => reviewDraftCache.getClassification(requestId, fingerprint)
// Slashes inside accent labels (UK/US) are not IPA delimiters.
const IPA_TOKEN_PATTERN = /(?<![\p{L}\p{N}])\/(?=[^/\r\n]*\p{L})[^/*`#:\r\n]+\/(?![\p{L}\p{N}])/gu
const UK_IPA_LABEL_PATTERN = /(?:\bUK\b|\bBritish\b|英式|英音)/i
const US_IPA_LABEL_PATTERN = /(?:\bUS\b|\bAmerican\b|美式|美音)/i
const CARD_PROMPT_BY_TYPE: Record<KnowledgeCardType, string> = {
  word: WORD_CARD_PROMPT,
  phrase: PHRASE_PATTERN_CARD_PROMPT,
  collocation: PHRASE_PATTERN_CARD_PROMPT,
  pattern: PHRASE_PATTERN_CARD_PROMPT,
  sentence: SENTENCE_CARD_PROMPT,
  paragraph: SENTENCE_CARD_PROMPT,
  grammar_concept: GRAMMAR_CONCEPT_CARD_PROMPT,
  comparison: COMPARISON_CARD_PROMPT
}

const assertRecord = (value: unknown, message: string): asserts value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(message)
  }
}

const parseRequiredText = (
  value: unknown,
  fieldName: string,
  maximumCharacters: number
): string => {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string.`)
  }

  const normalizedValue = value.trim()

  if (normalizedValue.length === 0) {
    throw new Error(`${fieldName} cannot be empty.`)
  }

  if (normalizedValue.length > maximumCharacters) {
    throw new Error(`${fieldName} must be ${maximumCharacters} characters or fewer.`)
  }

  return normalizedValue
}

const parseContext = (value: unknown): KnowledgeCardContextMessage[] => {
  if (!Array.isArray(value)) {
    throw new Error('Knowledge card context must be an array.')
  }

  if (value.length > KNOWLEDGE_CARD_CONTEXT_MESSAGE_LIMIT) {
    throw new Error(
      `Knowledge card context must contain ${KNOWLEDGE_CARD_CONTEXT_MESSAGE_LIMIT} messages or fewer.`
    )
  }

  return value.map((message) => {
    assertRecord(message, 'Knowledge card context contains an invalid message.')

    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new Error('Knowledge card context contains an invalid role.')
    }

    return {
      role: message.role,
      content: parseRequiredText(
        message.content,
        'Knowledge card context message',
        MAX_KNOWLEDGE_CARD_CONTEXT_CHARACTERS
      )
    }
  })
}

const validateGenerateKnowledgeCardRequest = (
  input: unknown
): GenerateKnowledgeCardRequest => {
  assertRecord(input, 'Knowledge card request must be an object.')

  const classification = validateRouterClassification(input.classification)

  if (
    classification.inputType === 'unknown' ||
    classification.needsClarification ||
    classification.responseMode !== 'card'
  ) {
    throw new Error('Router classification must use card responseMode.')
  }

  return {
    sourceQuestion: parseRequiredText(
      input.sourceQuestion,
      'Source question',
      MAX_KNOWLEDGE_CARD_CONTEXT_CHARACTERS
    ),
    recentContext: parseContext(input.recentContext),
    classification
  }
}

const extractJsonText = (output: string): string => {
  const normalizedOutput = output.trim()
  const codeFenceMatch = normalizedOutput.match(JSON_CODE_FENCE_PATTERN)
  return codeFenceMatch?.[1]?.trim() ?? normalizedOutput
}

const parseCardType = (value: unknown): KnowledgeCardType => {
  if (
    typeof value !== 'string' ||
    !KNOWLEDGE_CARD_TYPES.includes(value as KnowledgeCardType)
  ) {
    throw new Error('Knowledge card output has an invalid cardType.')
  }

  return value as KnowledgeCardType
}

const parseTargets = (value: unknown): string[] => {
  if (
    !Array.isArray(value) ||
    value.some((target) => typeof target !== 'string' || target.trim().length === 0)
  ) {
    throw new Error('Knowledge card output has invalid targets.')
  }

  return value.map((target) => target.trim())
}

const findLabeledIpa = (content: string, labelPattern: RegExp): string | undefined => {
  for (const line of content.split(/\r?\n/)) {
    const labelMatch = line.match(labelPattern)

    if (!labelMatch || labelMatch.index === undefined) {
      continue
    }

    const ipaMatches = [...line.matchAll(IPA_TOKEN_PATTERN)]
    const nearestIpa = ipaMatches
      .map((match) => ({
        distance: Math.abs((match.index ?? 0) - labelMatch.index!),
        value: match[0]
      }))
      .sort((firstMatch, secondMatch) => firstMatch.distance - secondMatch.distance)[0]

    if (nearestIpa) {
      return nearestIpa.value
    }
  }

  return undefined
}

export const normalizePhoneticSectionContent = (content: string): string => {
  const ipaTokens = [...content.matchAll(IPA_TOKEN_PATTERN)].map((match) => match[0])
  const uniqueIpaTokens = [...new Set(ipaTokens)]

  if (uniqueIpaTokens.length === 0) {
    throw new Error('Knowledge card phonetic section must contain IPA between forward slashes.')
  }

  if (uniqueIpaTokens.length === 1) {
    return `- **UK/US:** ${uniqueIpaTokens[0]}`
  }

  const labeledUkIpa = findLabeledIpa(content, UK_IPA_LABEL_PATTERN)
  const labeledUsIpa = findLabeledIpa(content, US_IPA_LABEL_PATTERN)
  const ukIpa = labeledUkIpa ?? uniqueIpaTokens.find((ipa) => ipa !== labeledUsIpa)!
  const usIpa = labeledUsIpa ?? uniqueIpaTokens.find((ipa) => ipa !== ukIpa)!

  if (ukIpa === usIpa) {
    return `- **UK/US:** ${ukIpa}`
  }

  return `- **UK:** ${ukIpa}\n- **US:** ${usIpa}`
}

const parseSection = (value: unknown): KnowledgeCardSection => {
  assertRecord(value, 'Knowledge card output contains an invalid section.')

  if (
    typeof value.module !== 'string' ||
    !ROUTER_MODULES.includes(value.module as RouterModule)
  ) {
    throw new Error('Knowledge card output contains an invalid section module.')
  }

  const module = value.module as RouterModule
  const examples = value.examples === undefined ? undefined : parseCardExamples(value.examples)
  if (module === 'examples' && typeof value.content !== 'string') {
    throw new ExampleValidationError('the examples module needs an empty content string.')
  }
  const content = (examples?.length || module === 'examples') && value.content === '' ? '' : parseRequiredText(
    value.content,
    'Knowledge card section content',
    MAX_KNOWLEDGE_CARD_CONTENT_CHARACTERS
  )

  return {
    module,
    content: module === 'phonetic' ? normalizePhoneticSectionContent(content) : content,
    ...(examples === undefined ? {} : { examples })
  }
}

const haveSameTargets = (firstTargets: string[], secondTargets: string[]): boolean => {
  return (
    firstTargets.length === secondTargets.length &&
    firstTargets.every((target, index) => target === secondTargets[index])
  )
}

const normalizeSections = (
  sections: KnowledgeCardSection[],
  classification: RouterClassification
): KnowledgeCardSection[] => {
  const requestedModules = getSelectedCardModules(classification)
  const requestedModuleSet = new Set(requestedModules)
  const seenModules = new Set<RouterModule>()
  const normalizedSections = sections.filter((section) => {
    if (
      !requestedModuleSet.has(section.module) ||
      seenModules.has(section.module)
    ) {
      return false
    }

    seenModules.add(section.module)
    return true
  })

  if (normalizedSections.length === 0) {
    throw new CardModuleValidationError(requestedModules)
  }

  const moduleOrder = new Map(
    getCardModuleOrder(classification.inputType).map((module, index) => [module, index])
  )

  return normalizedSections.sort(
    (firstSection, secondSection) =>
      (moduleOrder.get(firstSection.module) ?? Number.MAX_SAFE_INTEGER) -
      (moduleOrder.get(secondSection.module) ?? Number.MAX_SAFE_INTEGER)
  )
}

export const parseKnowledgeCard = (
  output: string,
  classification: RouterClassification
): KnowledgeCard => {
  let parsedOutput: unknown

  try {
    parsedOutput = JSON.parse(extractJsonText(output))
  } catch {
    throw new Error('Knowledge card output is not valid JSON.')
  }

  assertRecord(parsedOutput, 'Knowledge card output must be a JSON object.')

  const cardType = parseCardType(parsedOutput.cardType)
  const targets = parseTargets(parsedOutput.targets)

  if (cardType !== classification.inputType) {
    throw new Error('Knowledge card type does not match the Router classification.')
  }

  if (!haveSameTargets(targets, classification.targets)) {
    throw new Error('Knowledge card targets do not match the Router classification.')
  }

  if (!Array.isArray(parsedOutput.sections) || parsedOutput.sections.length === 0) {
    throw new Error('Knowledge card output must include at least one section.')
  }

  const sections = normalizeSections(
    parsedOutput.sections.map(parseSection),
    classification
  )

  return {
    cardType,
    targetText: parseRequiredText(
      parsedOutput.targetText,
      'Knowledge card targetText',
      MAX_KNOWLEDGE_CARD_CONTEXT_CHARACTERS
    ),
    targets,
    answer: parseRequiredText(
      parsedOutput.answer,
      'Knowledge card answer',
      MAX_KNOWLEDGE_CARD_CONTENT_CHARACTERS
    ),
    sections
  }
}

export const buildKnowledgeCardInput = (
  request: GenerateKnowledgeCardRequest,
  answerLanguage: string
): string => {
  return JSON.stringify(
    {
      router: request.classification,
      sourceQuestion: request.sourceQuestion,
      recentContext: request.recentContext,
      settings: {
        answerLanguage,
        requireExampleTranslations: requiresExampleTranslations(answerLanguage as DefaultAnswerLanguage, request.sourceQuestion),
        exampleCount: resolveExampleCount(request)
      }
    },
    null,
    2
  )
}

export const generateKnowledgeCard = async (
  options: GenerateKnowledgeCardOptions
): Promise<KnowledgeCard> => {
  const request = validateGenerateKnowledgeCardRequest(options.request)
  const exampleCount = resolveExampleCount(request)
  const cardPrompt = CARD_PROMPT_BY_TYPE[request.classification.inputType]
  const requireTranslations = requiresExampleTranslations(options.answerLanguage, request.sourceQuestion)
  const requireExampleModule = getSelectedCardModules(request.classification).includes('examples')
  const validateOutput = (output: string): KnowledgeCard => {
    options.signal?.throwIfAborted()
    const card = parseKnowledgeCard(output, request.classification)
    validateGeneratedExamples(card, requireTranslations, requireExampleModule)
    validateExampleCount(card, exampleCount, requireExampleModule)
    validateGeneratedCardModules(card, request.classification)
    return card
  }

  options.signal?.throwIfAborted()
  // Confidence is diagnostic only; every generation-affecting field participates in reuse.
  const fingerprint = createHash('sha256').update(JSON.stringify({
    request: { ...request, classification: { ...request.classification, confidence: 0 } },
    apiKey: options.apiKey, modelName: options.modelName, modelProvider: options.modelProvider,
    answerLanguage: options.answerLanguage, cardPrompt
  })).digest('hex')
  const cachedOutput = options.retryOfRequestId
    ? reviewDraftCache.take(options.retryOfRequestId, fingerprint) : undefined
  const output = cachedOutput ?? await generateProviderText({
    purpose: 'card-generation',
    apiKey: options.apiKey,
    modelName: options.modelName,
    modelProvider: options.modelProvider,
    prompt: buildKnowledgeCardInput(request, options.answerLanguage),
    responseFormat: 'json',
    ...(options.signal ? { signal: options.signal } : {}),
    systemPrompt: buildStructuredSystemInstructionWithAnswerLanguage(
      cardPrompt,
      options.answerLanguage
    )
  })
  let draft: KnowledgeCard
  try {
    draft = validateOutput(output)
  } catch (error) {
    options.signal?.throwIfAborted()
    throw new CardFormatError(output, error)
  }
  if (cachedOutput !== undefined) console.info('EnglishAsk resumed grammar review from a validated draft')
  const validatedDraftOutput = JSON.stringify(draft)
  const retainReviewDraft = (): void => {
    if (!options.requestId) return
    reviewDraftCache.put(options.requestId, fingerprint, validatedDraftOutput,
      options.retryContextFingerprint ? {
        fingerprint: options.retryContextFingerprint,
        classification: request.classification
      } : undefined)
  }
  let reviewed: KnowledgeCard
  try {
    reviewed = await reviewGrammar(draft, request.classification, {
      apiKey: options.apiKey,
      modelName: options.modelName,
      modelProvider: options.modelProvider,
      prompt: buildKnowledgeCardInput(request, options.answerLanguage),
      ...(options.signal ? { signal: options.signal } : {})
    })
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason
    if (isAbortError(error)) throw error
    retainReviewDraft()
    throw new CardReviewError(output,
      error instanceof GrammarReviewError ? error : new GrammarReviewError('internal_error'))
  }
  let card: KnowledgeCard
  try {
    card = validateOutput(JSON.stringify(reviewed))
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason
    retainReviewDraft()
    throw new CardReviewError(output, new GrammarReviewError('invalid_reviewed_card'))
  }

  console.info('Generated EnglishAsk knowledge card', {
    cardType: card.cardType,
    model: options.modelName,
    sectionCount: card.sections.length
  })

  return card
}
