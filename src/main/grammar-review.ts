import type { KnowledgeCard } from '../shared/knowledge-card'
import type { RouterClassification } from '../shared/router'
import { GRAMMAR_REVIEW_PROMPT } from '../shared/prompt-design'
import { generateProviderText, type GenerateProviderTextOptions } from './provider-adapters'

export const GRAMMAR_REVIEW_TIMEOUT_MS = 45_000
const MAX_REPLACEMENT_CHARACTERS = 20_000
const MAX_REVIEW_CHARACTERS = 300_000
const GRAMMAR_MODULES = new Set(['grammar', 'tense', 'voice', 'sentence_structure'])
const GRAMMAR_INTENTS = new Set(['explain_grammar', 'correct_sentence', 'analyze_sentence'])
const SKIP_AUTOMATIC_REVIEW_INTENTS = new Set(['translate', 'generate_examples', 'ask_pronunciation', 'polish_expression'])
const REVIEW_FAILURE_MESSAGES = {
  unknown: 'Unable to verify the grammar in this answer.',
  timeout: 'Grammar review exceeded its 45-second time limit.',
  authentication_failed: 'Grammar review provider rejected authentication or access. Check your API credentials.',
  rate_limited: 'Grammar review provider rate limit was reached.',
  provider_unavailable: 'Grammar review provider returned a server error.',
  network_failed: 'Grammar review could not connect to the provider.',
  request_failed: 'Grammar review provider request failed.',
  invalid_json: 'Grammar review returned invalid JSON.',
  invalid_response: 'Grammar review returned an invalid corrections structure.',
  response_too_large: 'Grammar review response exceeded the size limit.',
  invalid_correction: 'Grammar review returned an invalid correction.',
  unknown_field: 'Grammar review tried to change a field that does not exist.',
  duplicate_correction: 'Grammar review returned multiple corrections for the same field.',
  quote_mismatch: 'Grammar review quoted text that does not match the answer.',
  invalid_replacement: 'Grammar review returned an empty, oversized or unchanged replacement.',
  invalid_reviewed_card: 'The revised answer failed validation after grammar review.',
  internal_error: 'Grammar review could not prepare or process the request.'
} as const
export type GrammarReviewFailureCode = keyof typeof REVIEW_FAILURE_MESSAGES
export class GrammarReviewError extends Error {
  constructor(
    readonly code: GrammarReviewFailureCode = 'unknown',
    readonly elapsedMs?: number,
    readonly statusCode?: number
  ) {
    super(`[${code}] ${REVIEW_FAILURE_MESSAGES[code]} Please retry.`)
    this.name = 'GrammarReviewError'
  }
}
const MAX_ERROR_CAUSE_DEPTH = 5
const NETWORK_ERROR_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'])

function classifyProviderFailure(error: unknown): { code: GrammarReviewFailureCode; statusCode?: number } {
  let current = error
  const seen = new Set<unknown>()
  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH && current && typeof current === 'object' && !seen.has(current); depth++) {
    seen.add(current)
    const candidate = current as { statusCode?: unknown; code?: unknown; cause?: unknown; lastError?: unknown }
    const status = candidate.statusCode
    if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599) {
      return { code: status === 401 || status === 403 ? 'authentication_failed'
        : status === 429 ? 'rate_limited' : status >= 500 ? 'provider_unavailable' : 'request_failed', statusCode: status }
    }
    if (typeof candidate.code === 'string' && NETWORK_ERROR_CODES.has(candidate.code)) return { code: 'network_failed' }
    current = candidate.lastError ?? candidate.cause
  }
  return { code: 'request_failed' }
}
const GRAMMAR_TOPIC = /\b(?:past (?:simple|tense|perfect|participle)|present (?:simple|tense|perfect|continuous)|future (?:perfect|tense)|passive (?:voice|construction)|active voice|(?:in)?direct object|subject[- ]verb agreement|relative clause|to[- ]infinitive|double[- ]object|subjunctive|conditional clause|participle)\b|时态|过去时|现在时|将来时|完成时|进行时|语态|分词|宾语|定语从句|主谓一致|虚拟语气|不定式/i
export function needsGrammarReview(card: KnowledgeCard, classification: RouterClassification): boolean {
  if (GRAMMAR_INTENTS.has(classification.intent)) return true
  if (SKIP_AUTOMATIC_REVIEW_INTENTS.has(classification.intent)) return false
  // Classify risk from the learning request, not incidental wording in the generated answer.
  return card.cardType === 'grammar_concept' ||
    classification.modules.some(module => GRAMMAR_MODULES.has(module)) ||
    (card.cardType === 'comparison' && GRAMMAR_TOPIC.test([classification.targetText, ...classification.targets, classification.focusText].join('\n')))
}

function getEditableFields(card: KnowledgeCard): Map<string, string> {
  const fields = new Map([['answer', card.answer], ...card.sections.map(section => [section.module, section.content] as [string, string])])
  for (const section of card.sections) {
    section.examples?.forEach((example, index) => {
      const prefix = section.module + '.examples.' + index
      fields.set(prefix + '.english', example.english)
      if (example.translation !== undefined) fields.set(prefix + '.translation', example.translation)
    })
  }
  return fields
}

export function applyGrammarCorrections(card: KnowledgeCard, output: string): { card: KnowledgeCard; correctionCount: number } {
  if (output.length > MAX_REVIEW_CHARACTERS) throw new GrammarReviewError('response_too_large')
  let parsed: unknown
  try {
    parsed = JSON.parse(output.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1'))
  } catch {
    throw new GrammarReviewError('invalid_json')
  }
  if (!parsed || typeof parsed !== 'object' || !('corrections' in parsed) ||
      !Array.isArray(parsed.corrections)) {
    throw new GrammarReviewError('invalid_response')
  }
  const fields = getEditableFields(card)
  if (parsed.corrections.length > fields.size) throw new GrammarReviewError('invalid_correction')
  const replacements = new Map<string, string>()
  for (const correction of parsed.corrections) {
    if (!correction || typeof correction !== 'object') throw new GrammarReviewError('invalid_correction')
    const { field, quote, reason, replacement } = correction
    if (typeof field !== 'string' || !fields.has(field)) throw new GrammarReviewError('unknown_field')
    if (replacements.has(field)) throw new GrammarReviewError('duplicate_correction')
    if (typeof quote !== 'string' || !quote.trim() || !fields.get(field)!.includes(quote)) throw new GrammarReviewError('quote_mismatch')
    if (typeof reason !== 'string' || !reason.trim()) throw new GrammarReviewError('invalid_correction')
    if (typeof replacement !== 'string' || !replacement.trim() ||
        replacement.length > MAX_REPLACEMENT_CHARACTERS || replacement.trim() === fields.get(field)) {
      throw new GrammarReviewError('invalid_replacement')
    }
    replacements.set(field, replacement.trim())
  }
  if (!replacements.size) return { card, correctionCount: 0 }
  return {
    card: {
      ...card,
      answer: replacements.get('answer') ?? card.answer,
      sections: card.sections.map(section => {
        const changedExamples = section.examples?.map((example, index) => {
          const prefix = section.module + '.examples.' + index
          return {
            ...example,
            english: replacements.get(prefix + '.english') ?? example.english,
            ...(example.translation === undefined ? {} : {
              translation: replacements.get(prefix + '.translation') ?? example.translation
            })
          }
        })
        return replacements.has(section.module) || changedExamples
          ? { ...section, content: replacements.get(section.module) ?? section.content,
            ...(changedExamples ? { examples: changedExamples } : {}) } : section
      })
    },
    correctionCount: replacements.size
  }
}

export async function reviewGrammar(
  card: KnowledgeCard,
  classification: RouterClassification,
  options: Omit<GenerateProviderTextOptions, 'responseFormat' | 'systemPrompt'>
): Promise<KnowledgeCard> {
  options.signal?.throwIfAborted()
  if (!needsGrammarReview(card, classification)) {
    console.info('EnglishAsk grammar review skipped', { cardType: card.cardType, intent: classification.intent, reason: 'not_an_explicit_grammar_task' })
    return card
  }
  const startedAt = performance.now()
  let stage: 'prepare' | 'request' | 'validate' = 'prepare'
  let timedOut = false
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true })
  let timeout: ReturnType<typeof setTimeout> | undefined
  let rejectAbort: (() => void) | undefined
  try {
    const prompt = JSON.stringify({ learningInput: JSON.parse(options.prompt), draft: card,
      editableFields: [...getEditableFields(card).keys()] })
    stage = 'request'
    // Bound the review even if a provider fails to honor the cancellation signal.
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(controller.signal.reason)
      controller.signal.addEventListener('abort', rejectAbort, { once: true })
      timeout = setTimeout(() => {
        timedOut = true
        controller.abort(new GrammarReviewError('timeout'))
      }, GRAMMAR_REVIEW_TIMEOUT_MS)
    })
    const output = await Promise.race([
      generateProviderText({
        ...options,
        prompt,
        signal: controller.signal,
        responseFormat: 'json',
        purpose: 'grammar-review',
        systemPrompt: GRAMMAR_REVIEW_PROMPT
      }),
      aborted
    ])
    options.signal?.throwIfAborted()
    stage = 'validate'
    const result = applyGrammarCorrections(card, output)
    console.info('EnglishAsk grammar review completed', {
      cardType: card.cardType, correctionCount: result.correctionCount,
      elapsedMs: Math.round(performance.now() - startedAt)
    })
    return result.card
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason
    const failure = timedOut ? { code: 'timeout' as const }
      : error instanceof GrammarReviewError ? { code: error.code, statusCode: error.statusCode }
      : stage === 'request' ? classifyProviderFailure(error) : { code: 'internal_error' as const }
    const details = new GrammarReviewError(failure.code, Math.round(performance.now() - startedAt),
      'statusCode' in failure ? failure.statusCode : undefined)
    console.warn('EnglishAsk grammar review failed', {
      cardType: card.cardType, provider: options.modelProvider, stage,
      code: details.code, elapsedMs: details.elapsedMs,
      ...(details.statusCode === undefined ? {} : { statusCode: details.statusCode })
    })
    throw details
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort)
  }
}
