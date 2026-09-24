import type { JevRoutingConfiguration } from '../shared/jev'
import { CARD_MODULE_RULES } from '../shared/card-modules'
import type { RouterClassification, RouterRoutingInfo, RouterInputType, RouterStructureType } from '../shared/router'
import { classifyWithJev, JEV_ROUTER_FIELDS, type JevRouterResult } from './jev-router'
import { classifyEnglishRequest, type ClassifyEnglishRequestOptions } from './router-classifier'

// A conservative initial gate, not a calibrated accuracy guarantee.
export const JEV_ROUTING_MIN_CONFIDENCE = 0.8
const BARE_WORD_PATTERN = /^[a-z]+(?:[-'][a-z]+)*$/i
// Certainty of this deterministic routing policy, not a claim about spelling or meaning.
const RULE_ROUTING_CONFIDENCE = 1
const STRUCTURES: Record<RouterInputType, RouterStructureType> = {
  word: 'single_word', phrase: 'fixed_expression', collocation: 'collocation', pattern: 'pattern',
  sentence: 'complete_sentence', paragraph: 'long_text', grammar_concept: 'abstract_concept',
  comparison: 'multi_target_comparison', unknown: 'unknown'
}

export const canUseJevLabels = (result: JevRouterResult): boolean => {
  const { labels } = result
  return JEV_ROUTER_FIELDS.every(field => Number.isFinite(result.confidence[field]) &&
    result.confidence[field] >= JEV_ROUTING_MIN_CONFIDENCE && result.confidence[field] <= 1) &&
    STRUCTURES[labels.inputType] === labels.structureType &&
    (labels.responseMode !== 'card' || (labels.inputType !== 'unknown' && labels.intent !== 'unknown')) &&
    (labels.inputType !== 'comparison' || labels.intent === 'compare_difference') &&
    (labels.intent !== 'compare_difference' || labels.inputType === 'comparison' || labels.responseMode === 'clarification')
}

export const classifyWithHybridRouter = async (
  options: Omit<ClassifyEnglishRequestOptions, 'requiredLabels'> & { jevApiKey?: string; jevConfiguration?: JevRoutingConfiguration; onRouting?: (info: RouterRoutingInfo) => void }
): Promise<RouterClassification> => {
  const { jevApiKey, jevConfiguration, onRouting, ...originalOptions } = options
  const configuration = jevConfiguration ?? (jevApiKey ? { channel: 'openrouter' as const, apiKey: jevApiKey } : undefined)
  options.signal?.throwIfAborted()
  const target = options.request.question.trim()
  if (options.request.history.length === 0 && BARE_WORD_PATTERN.test(target)) {
    onRouting?.({ source: 'rule' })
    console.info('EnglishAsk routing source', { source: 'rule' })
    return {
      inputType: 'word', structureType: 'single_word', intent: 'explain_meaning', responseMode: 'card',
      targetText: target, targets: [target], focusText: '', modules: [...CARD_MODULE_RULES.word.defaults],
      confidence: RULE_ROUTING_CONFIDENCE, needsClarification: false, clarificationQuestion: ''
    }
  }
  if (configuration?.apiKey.trim()) {
    onRouting?.({ source: 'jev-fallback', channel: configuration.channel })
    try {
      const result = await classifyWithJev({ ...configuration, request: options.request,
        ...(options.signal ? { signal: options.signal } : {}) })
      options.signal?.throwIfAborted()
      if (canUseJevLabels(result)) {
        const confidence = Math.min(...JEV_ROUTER_FIELDS.map(field => result.confidence[field]))
        const classification = await classifyEnglishRequest({ ...originalOptions, requiredLabels: result.labels })
        options.signal?.throwIfAborted()
        console.info('EnglishAsk routing source', { source: 'jev-assisted',
          jevElapsedMs: result.elapsedMs, confidence })
        onRouting?.({ source: 'jev-assisted', channel: configuration.channel })
        return { ...classification, confidence: Math.min(confidence, classification.confidence) }
      }
      console.info('EnglishAsk routing fallback', { reason: 'uncertain-or-inconsistent-jev-labels' })
    } catch {
      // Aborted asks must never start a fallback request. Do not log raw provider exceptions.
      options.signal?.throwIfAborted()
      console.warn('EnglishAsk routing fallback', { reason: 'jev-or-completion-failed' })
    }
  }
  options.signal?.throwIfAborted()
  if (!configuration?.apiKey.trim()) onRouting?.({ source: 'original' })
  console.info('EnglishAsk routing source', { source: 'original' })
  return classifyEnglishRequest(originalOptions)
}
