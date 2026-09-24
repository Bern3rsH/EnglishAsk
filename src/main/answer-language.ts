import {
  DEFAULT_ANSWER_LANGUAGE,
  type DefaultAnswerLanguage
} from '../shared/ai'

// Mask learning material while retaining the surrounding request's grammatical shape.
const QUOTED_LANGUAGE_MATERIAL = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|"[^"\n]*"|“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|(?:^|\s)'[^'\n]*'/g
const LANGUAGE_DIRECTIVES = [
  /^(?:please\s+)?(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:answer|reply|respond|explain|describe|clarify)\b.*?\b(?:in|using)\s+(?:(?:plain|simple)\s+)?(?<language>english|chinese|simplified chinese)(?:\s+(?:only|please|this time))*$/i,
  /^(?:please\s+)?(?:(?:can|could|would|will) you\s+)?(?:please\s+)?use\s+(?:(?:plain|simple)\s+)?(?<language>english|chinese|simplified chinese)(?:\s+to\s+(?:answer|reply|respond|explain|describe|clarify)\b.*|\s+(?:for|in)\s+(?:your|the|this)\s+(?:answer|reply|response|explanation))?$/i,
  /^(?:i(?:'d| would)?\s+(?:prefer|like|want))\s+(?:(?:an?|the)\s+)?(?:(?<language>english|chinese|simplified chinese)\s+(?:answer|reply|response|explanation))(?:\s+(?:please|this time))?$/i,
  /^(?:(?:your|the|this)\s+)?(?:answer|reply|response|explanation)\s+(?:should|can)\s+be\s+in\s+(?<language>english|chinese|simplified chinese)(?:\s+please)?$/i,
  /^(?:in\s+)?(?<language>english|chinese|simplified chinese)\s+(?:only|please)(?:\s+please)?$/i,
  /^(?:请|麻烦)?(?:这次|本次)?(?:请)?(?:只)?(?:用|使用)(?<language>中文|简体中文|英文|英语)(?:来)?(?:回答|回复|解释|讲解|说明).*(?:好吗|可以吗|吧|就好|即可)?$/,
  /^(?:这次|本次)?(?:的)?(?:回答|回复|解释|讲解|说明)(?:请)?(?:只)?(?:用|使用)(?<language>中文|简体中文|英文|英语)(?:就好|即可|吧|可以吗)?$/,
  /^(?:(?:这次|本次)(?:请)?(?:用)?|(?:请)?用)(?<language>中文|简体中文|英文|英语)(?:就好|即可|吧|回答)?$/,
  /^(?:请)?(?<language>中文|简体中文|英文|英语)(?:回答|回复|解释|讲解|说明)(?:一下)?(?:就好|即可|吧)?$/,
  /^(?:我想要|我希望|我更想要)(?:用)?(?<language>中文|简体中文|英文|英语)(?:的)?(?:回答|回复|解释|讲解)(?:一下|就好)?$/
]
const NEGATED_LANGUAGE_REQUEST = /^(?:please\s+)?(?:do not|don't|never|you shouldn't|you cannot|you can't)\s+(?:answer|reply|respond|explain|describe|clarify|use)\b|\bnot\s+(?:in|using)\s+(?:english|chinese)\b|^(?:请)?(?:不要|不用|别用|不想|无需|不必)/i
const SCOPED_LANGUAGE_REQUEST = /^(?:(?:please|can you|could you)\s+)*(?:translate|give|provide|write|generate)\b|^(?:请)?(?:翻译|把.+翻译|将.+翻译|例句|示例|标题|音标)|\b(?:only|just)\s+(?:the\s+)?(?:examples?|translations?|headings?|titles?)\b|\b(?:explain|describe)\s+(?:why|how)\s+(?:people|students)\s+(?:answer|reply|respond|speak|write)\s+in\b/i

const languageFromDirective = (directive: string): DefaultAnswerLanguage | undefined => {
  if (NEGATED_LANGUAGE_REQUEST.test(directive) || SCOPED_LANGUAGE_REQUEST.test(directive)) return undefined
  for (const pattern of LANGUAGE_DIRECTIVES) {
    const requested = pattern.exec(directive)?.groups?.language.toLowerCase()
    if (requested) return /^(english|英文|英语)$/.test(requested) ? 'en' : 'zh'
  }
  return undefined
}

export const resolveQuestionAnswerLanguage = (
  question: string,
  defaultLanguage: DefaultAnswerLanguage
): DefaultAnswerLanguage => {
  const unquoted = question.replace(QUOTED_LANGUAGE_MATERIAL, ' [quoted] ').replace(/^\s*>.*$/gm, '')
  let language = defaultLanguage
  for (const sentence of unquoted.split(/[.!?。！？;；\n]+/)) {
    const directive = sentence.trim().replace(/’/g, "'").replace(/\s+/g, ' ')
    const wholeRequest = languageFromDirective(directive)
    if (wholeRequest) language = wholeRequest
    // Separate trailing instructions without breaking lists inside a topic-bearing request.
    for (const clause of directive.split(/[,，]+/)) {
      const requested = languageFromDirective(clause.trim())
      if (requested) language = requested
    }
  }
  return language
}

const answerLanguageInstructions: Record<DefaultAnswerLanguage, string> = {
  zh: 'Answer in Simplified Chinese. Keep English examples and corrections in English when needed. Unless the user explicitly asks for English-only examples, immediately follow every complete English example sentence with its natural Simplified Chinese translation.',
  en: 'Answer in English.'
}

const structuredAnswerLanguageInstructions: Record<DefaultAnswerLanguage, string> = {
  zh: 'For learner-facing JSON string fields, write Simplified Chinese explanations. Keep English examples and corrections in English when needed. Unless the user explicitly asks for English-only examples, pair every complete English example sentence with its natural Simplified Chinese translation. When the schema provides separate english and translation fields, put each language in its designated field, never both in english. For Markdown-only fields without a paired schema, place the translation immediately after the example in the same field. Preserve fixed JSON keys and exact learning targets.',
  en: 'For learner-facing JSON string fields, write English explanations.'
}

export const normalizeDefaultAnswerLanguage = (_value: unknown): DefaultAnswerLanguage => {
  return DEFAULT_ANSWER_LANGUAGE
}

export const buildSystemInstructionWithAnswerLanguage = (
  systemPrompt: string,
  answerLanguage: DefaultAnswerLanguage
): string => {
  return `${systemPrompt}\n\n${answerLanguageInstructions[answerLanguage]}`
}

export const buildStructuredSystemInstructionWithAnswerLanguage = (
  systemPrompt: string,
  answerLanguage: DefaultAnswerLanguage
): string => {
  return `${systemPrompt}\n\n${structuredAnswerLanguageInstructions[answerLanguage]}`
}
