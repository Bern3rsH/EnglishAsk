import type { AskEnglishRequest, ModelProvider } from '../shared/ai'
import { buildRouterCompletionPrompt, ROUTER_CLASSIFIER_PROMPT } from '../shared/prompt-design'
import {
  ROUTER_INPUT_TYPES,
  ROUTER_INTENTS,
  ROUTER_MODULES,
  ROUTER_RESPONSE_MODES,
  ROUTER_STRUCTURE_TYPES,
  type RouterClassification,
  type RouterInputType,
  type RouterIntent,
  type RouterModule,
  type RouterResponseMode,
  type RouterStructureType
} from '../shared/router'
import { buildEnglishAskPrompt } from './ai-request'
import type { JevRouteLabels } from './jev-router'
import {
  generateProviderText,
  ProviderEmptyResponseError
} from './provider-adapters'

export interface ClassifyEnglishRequestOptions {
  apiKey: string
  modelName: string
  modelProvider: ModelProvider
  request: AskEnglishRequest
  signal?: AbortSignal
  requiredLabels?: JevRouteLabels
}

const JSON_CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i
const ROUTER_OUTPUT_ATTEMPT_LIMIT = 2
const ROUTER_RETRY_INSTRUCTION =
  'The previous Router output was empty or invalid. Return exactly one complete JSON object matching every field and enum in the schema.'
const ROUTER_COMPLETION_FIELDS = ['targetText', 'targets', 'focusText', 'modules', 'confidence',
  'needsClarification', 'clarificationQuestion'] as const
const COMPLETION_RETRY_INSTRUCTION =
  'The previous completion was empty or invalid. Return exactly the seven completion fields. Do not return or change classification labels.'

export class RouterOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RouterOutputError'
  }
}

const extractJsonObjectCandidates = (output: string): string[] => {
  const candidates: string[] = []

  for (let startIndex = 0; startIndex < output.length; startIndex += 1) {
    if (output[startIndex] !== '{') {
      continue
    }

    let depth = 0
    let isInsideString = false
    let isEscaped = false

    for (let currentIndex = startIndex; currentIndex < output.length; currentIndex += 1) {
      const character = output[currentIndex]

      if (isInsideString) {
        if (isEscaped) {
          isEscaped = false
        } else if (character === '\\') {
          isEscaped = true
        } else if (character === '"') {
          isInsideString = false
        }

        continue
      }

      if (character === '"') {
        isInsideString = true
      } else if (character === '{') {
        depth += 1
      } else if (character === '}') {
        depth -= 1

        if (depth === 0) {
          candidates.push(output.slice(startIndex, currentIndex + 1))
          startIndex = currentIndex
          break
        }
      }
    }
  }

  return candidates
}

const assertRecord: (value: unknown) => asserts value is Record<string, unknown> = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Router output must be a JSON object.')
  }
}

const parseEnum = <Value extends string>(
  value: unknown,
  allowedValues: readonly Value[],
  fieldName: string
): Value => {
  if (typeof value !== 'string' || !allowedValues.includes(value as Value)) {
    throw new Error(`Router output has an invalid ${fieldName}.`)
  }

  return value as Value
}

const parseString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`Router output has an invalid ${fieldName}.`)
  }

  return value.trim()
}

const parseOptionalString = (value: unknown, fieldName: string): string => {
  if (value === null || value === undefined) {
    return ''
  }

  return parseString(value, fieldName)
}

const parseStringArray = (value: unknown, fieldName: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Router output has an invalid ${fieldName}.`)
  }

  const normalizedValues = value.map((item) => item.trim())

  if (normalizedValues.some((item) => item.length === 0)) {
    throw new Error(`Router output has an empty value in ${fieldName}.`)
  }

  return normalizedValues
}

const parseModules = (value: unknown): RouterModule[] => {
  if (!Array.isArray(value)) {
    throw new Error('Router output has invalid modules.')
  }

  const modules = value.map((module) =>
    parseEnum(module, ROUTER_MODULES, 'module')
  )

  if (new Set(modules).size !== modules.length) {
    throw new Error('Router output contains duplicate modules.')
  }

  return modules
}

const parseConfidence = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Router output confidence must be between 0 and 1.')
  }

  return value
}

const parseBoolean = (value: unknown, fieldName: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new Error(`Router output has an invalid ${fieldName}.`)
  }

  return value
}

const extractJsonText = (output: string): string => {
  const normalizedOutput = output.trim()
  const codeFenceMatch = normalizedOutput.match(JSON_CODE_FENCE_PATTERN)
  return codeFenceMatch?.[1]?.trim() ?? normalizedOutput
}

export const validateRouterClassification = (
  parsedOutput: unknown
): RouterClassification => {
  assertRecord(parsedOutput)

  const inputType = parseEnum<RouterInputType>(
    parsedOutput.inputType,
    ROUTER_INPUT_TYPES,
    'inputType'
  )
  const structureType = parseEnum<RouterStructureType>(
    parsedOutput.structureType,
    ROUTER_STRUCTURE_TYPES,
    'structureType'
  )
  const targets = parseStringArray(parsedOutput.targets, 'targets')
  const intent = parseEnum<RouterIntent>(parsedOutput.intent, ROUTER_INTENTS, 'intent')
  const needsClarification = parseBoolean(
    parsedOutput.needsClarification,
    'needsClarification'
  )
  const responseMode = parseEnum<RouterResponseMode>(
    parsedOutput.responseMode,
    ROUTER_RESPONSE_MODES,
    'responseMode'
  )
  const clarificationQuestion = parseOptionalString(
    parsedOutput.clarificationQuestion,
    'clarificationQuestion'
  )

  if (targets.length === 0 && responseMode === 'card') {
    throw new Error('Router output must include at least one target.')
  }

  if (
    inputType === 'comparison' &&
    new Set(targets).size < 2 &&
    !needsClarification
  ) {
    throw new Error('Comparison routes must include at least two distinct targets.')
  }

  if (needsClarification && clarificationQuestion.length === 0) {
    throw new Error('Router output must include a clarification question.')
  }

  if (needsClarification !== (responseMode === 'clarification')) {
    throw new Error('Router responseMode does not match its clarification state.')
  }

  if (responseMode === 'card' && inputType === 'unknown') {
    throw new Error('Unknown Router input cannot use card responseMode.')
  }

  return {
    inputType,
    structureType,
    targetText: parseString(parsedOutput.targetText, 'targetText'),
    targets,
    focusText: parseOptionalString(parsedOutput.focusText, 'focusText'),
    intent,
    modules: parseModules(parsedOutput.modules),
    confidence: parseConfidence(parsedOutput.confidence),
    needsClarification,
    clarificationQuestion,
    responseMode
  }
}

export const parseRouterClassification = (output: string): RouterClassification => {
  const extractedOutput = extractJsonText(output)
  const candidates = [extractedOutput, ...extractJsonObjectCandidates(extractedOutput)]
  let validationError: RouterOutputError | null = null

  for (const candidate of new Set(candidates)) {
    let parsedOutput: unknown

    try {
      parsedOutput = JSON.parse(candidate)
    } catch {
      continue
    }

    try {
      return validateRouterClassification(parsedOutput)
    } catch (error) {
      validationError ??= new RouterOutputError(
        error instanceof Error
          ? error.message
          : 'Router output has an invalid classification.'
      )
    }
  }

  if (validationError) {
    throw validationError
  }

  throw new RouterOutputError('Router output is not valid JSON.')
}

export const parseRouterCompletion = (output: string, labels: JevRouteLabels): RouterClassification => {
  try {
    const completion: unknown = JSON.parse(extractJsonText(output))
    assertRecord(completion)
    if (Object.keys(completion).length !== ROUTER_COMPLETION_FIELDS.length ||
      !ROUTER_COMPLETION_FIELDS.every(field => Object.hasOwn(completion, field))) {
      throw new Error('Router completion must contain exactly the seven completion fields.')
    }
    // Categorical fields come only from Jev, never from generated completion text.
    const classification = validateRouterClassification({ ...completion, ...labels })
    if (classification.responseMode === 'card' && (!classification.targetText || !classification.modules.length)) {
      throw new Error('Router completion must include a card target and selected modules.')
    }
    if (classification.responseMode !== 'clarification' && classification.clarificationQuestion) {
      throw new Error('Router completion has an unexpected clarification question.')
    }
    if (classification.responseMode === 'conversational' && (classification.targetText || classification.targets.length ||
      classification.focusText || classification.modules.length)) {
      throw new Error('Conversational completion must not include learning targets or modules.')
    }
    return classification
  } catch (error) {
    throw new RouterOutputError(error instanceof SyntaxError ? 'Router completion is not valid JSON.'
      : error instanceof Error ? error.message : 'Router completion is invalid.')
  }
}

export const classifyEnglishRequest = async (
  options: ClassifyEnglishRequestOptions
): Promise<RouterClassification> => {
  const systemPrompt = options.requiredLabels
    ? buildRouterCompletionPrompt(options.requiredLabels)
    : ROUTER_CLASSIFIER_PROMPT
  for (let attempt = 1; attempt <= ROUTER_OUTPUT_ATTEMPT_LIMIT; attempt += 1) {
    try {
      const output = await generateProviderText({
        purpose: 'routing',
        apiKey: options.apiKey,
        modelName: options.modelName,
        modelProvider: options.modelProvider,
        prompt: buildEnglishAskPrompt(options.request),
        responseFormat: 'json',
        ...(options.signal ? { signal: options.signal } : {}),
        systemPrompt:
          attempt === 1
            ? systemPrompt
            : `${systemPrompt}\n\n${options.requiredLabels ? COMPLETION_RETRY_INSTRUCTION : ROUTER_RETRY_INSTRUCTION}`
      })

      return options.requiredLabels ? parseRouterCompletion(output, options.requiredLabels) : parseRouterClassification(output)
    } catch (error) {
      const shouldRetryRouterOutput =
        (error instanceof ProviderEmptyResponseError || error instanceof RouterOutputError) &&
        attempt < ROUTER_OUTPUT_ATTEMPT_LIMIT

      if (!shouldRetryRouterOutput) {
        throw error
      }

      options.signal?.throwIfAborted()
      console.warn('EnglishAsk Router received an invalid response; retrying', {
        attempt,
        message: error.message,
        model: options.modelName,
        provider: options.modelProvider
      })
    }
  }

  throw new Error('Router classification exhausted all attempts.')
}
