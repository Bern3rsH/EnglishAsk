import type { GenerateKnowledgeCardRequest, KnowledgeCard } from './knowledge-card'
import { ExampleValidationError } from './card-examples'

const DEFAULT_EXAMPLE_COUNT = 2
const GRAMMAR_EXAMPLE_COUNT = 3
const MAX_EXAMPLE_COUNT = 100
const ENGLISH_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']
const ENGLISH_TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const CHINESE_DIGITS = '零一二三四五六七八九'
const QUANTITY = '(\\d+|[零一二两三四五六七八九十百]+|one hundred|(?:' + ENGLISH_TENS.join('|') +
  ')(?:[- ](?:' + ENGLISH_NUMBERS.slice(1, 10).join('|') + '))?|' + ENGLISH_NUMBERS.join('|') + ')'
const EXAMPLE_QUANTITY = new RegExp('\\b' + QUANTITY + '(?:\\s+(?:short|simple|natural|English|different|more|practical))*\\s+examples?\\b|' +
  QUANTITY + '\\s*(?:个|条|句|组)?(?:英文|自然|简单|实用|不同)*例句', 'gi')
const FLEXIBLE_QUANTITY = /at least|at most|up to|no more than|between|至少|最多|不超过|不少于/i
const QUANTITY_RANGE = new RegExp('\\d\\s*[-–~]\\s*\\d|' + QUANTITY + '\\s*(?:[到至]|\\bto\\b|\\bor\\b)\\s*' + QUANTITY, 'i')
const VAGUE_QUANTITY = /(?:several|a few|many|some|multiple)\s+(?:\w+\s+)?examples?|(?:几|若干|多个)(?:个|条|句)?例句/i
const PER_TARGET = /\b(?:each|per (?:word|target|expression))\b|每个|各(?:给|举|写|造|提供)?/i
const TOTAL_QUANTITY = /\b(?:in total|altogether)\b|总共|一共|合计/i

export interface ExampleCountPolicy {
  count: number | null
  source: 'default' | 'request' | 'unresolved'
}

function parseQuantity(text: string): number {
  if (/^\d+$/.test(text)) return Number(text)
  const english = ENGLISH_NUMBERS.indexOf(text.toLowerCase())
  if (english >= 0) return english
  if (text.toLowerCase() === 'one hundred') return MAX_EXAMPLE_COUNT
  const [tensWord, unitWord] = text.toLowerCase().split(/[- ]/)
  const tensIndex = ENGLISH_TENS.indexOf(tensWord)
  if (tensIndex >= 0) return (tensIndex + 2) * 10 + (unitWord ? ENGLISH_NUMBERS.indexOf(unitWord) : 0)
  const chinese = text.replace('两', '二')
  if (!/^(?:[一二三四五六七八九]?十[一二三四五六七八九]?|[零一二三四五六七八九]|一?百)$/.test(chinese)) return NaN
  if (chinese === '一百' || chinese === '百') return MAX_EXAMPLE_COUNT
  if (chinese.includes('十')) {
    const [tens, units] = chinese.split('十')
    return (tens ? CHINESE_DIGITS.indexOf(tens) : 1) * 10 + (units ? CHINESE_DIGITS.indexOf(units) : 0)
  }
  return chinese.length === 1 ? CHINESE_DIGITS.indexOf(chinese) : NaN
}

export function resolveExampleCount(request: GenerateKnowledgeCardRequest): ExampleCountPolicy {
  // Quoted learning material is not itself a request for an example count.
  const question = request.sourceQuestion.replace(/"[^"\n]*"|“[^”\n]*”|`[^`\n]*`/g, '')
  if (VAGUE_QUANTITY.test(question) || QUANTITY_RANGE.test(question)) return { count: null, source: 'unresolved' }
  const matches = [...question.matchAll(EXAMPLE_QUANTITY)]
  if (matches.length) {
    if (matches.length !== 1 || FLEXIBLE_QUANTITY.test(question)) return { count: null, source: 'unresolved' }
    const quantity = parseQuantity(matches[0][1] ?? matches[0][2])
    const count = quantity * (PER_TARGET.test(question) && !TOTAL_QUANTITY.test(question) ? request.classification.targets.length : 1)
    if (!Number.isInteger(count) || count < 1 || count > MAX_EXAMPLE_COUNT) {
      throw new ExampleValidationError('request between 1 and 100 examples.')
    }
    return { count, source: 'request' }
  }
  const type = request.classification.inputType
  return { count: type === 'grammar_concept' ? GRAMMAR_EXAMPLE_COUNT
    : type === 'comparison' ? request.classification.targets.length : DEFAULT_EXAMPLE_COUNT, source: 'default' }
}

export function validateExampleCount(card: KnowledgeCard, policy: ExampleCountPolicy, requireModule: boolean): void {
  if (policy.count === null) return
  const section = card.sections.find(section => section.module === 'examples')
  if (!section && !requireModule) return
  const actual = section?.examples?.length ?? 0
  if (actual !== policy.count) {
    throw new ExampleValidationError(`expected ${policy.count} examples in the examples module; received ${actual}.`)
  }
}
