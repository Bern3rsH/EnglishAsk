import type { ChatMessage, PronunciationAudioResponse } from '../../shared/ai'

export const PRONUNCIATION_LANGUAGE = 'en-US'
export const PRONUNCIATION_RATE = 0.9

const ENGLISH_LANGUAGE_PATTERN = /^en(?:[-_]|$)/i
const AMERICAN_ENGLISH_LANGUAGE_PATTERN = /^en[-_]US$/i
const GOOGLE_VOICE_NAME_PATTERN = /google/i
const BASE64_AUDIO_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

const MAX_PRONUNCIATION_TARGET_LENGTH = 1_000
const PLACEHOLDER_PATTERN = /\b(?:sb|sth)\b|\bs\.o\.|\bs\.th\./i
const COMBINED_COMPARISON_PATTERN = /\s(?:vs\.?|versus)\s/i
const SPEAKABLE_ENGLISH_PATTERN = /^[\p{Script=Latin}\p{M}\d\s.,!?;:'"’‘“”()\-–—]+$/u

function cleanPronunciationTarget(value: string): string | null {
  const text = value.replace(/[*_`]/g, '').trim().replace(/\s+/g, ' ')
  return text.length > 0 && text.length <= MAX_PRONUNCIATION_TARGET_LENGTH &&
    /\p{Script=Latin}/u.test(text) && SPEAKABLE_ENGLISH_PATTERN.test(text) &&
    !PLACEHOLDER_PATTERN.test(text) && !COMBINED_COMPARISON_PATTERN.test(text)
    ? text : null
}

export const getPronunciationPlaybackKey = (messageId: string, target: string): string =>
  JSON.stringify([messageId, target])

export const getMessagePronunciationTargets = (message: ChatMessage): string[] => {
  if (message.role !== 'assistant' || !message.knowledgeCard) {
    return []
  }

  const isTranslation =
    (message.routerDiagnostic?.status === 'success' &&
      message.routerDiagnostic.classification.intent === 'translate') ||
    message.knowledgeCard.sections.some((section) => section.module === 'translation')

  if (isTranslation) {
    return []
  }

  const card = message.knowledgeCard
  const cleanTargets = [...new Set(card.targets.map(cleanPronunciationTarget).filter((target): target is string => target !== null))]
  if (card.cardType === 'pattern' || card.targets.some(target => PLACEHOLDER_PATTERN.test(target))) {
    // Never speak placeholder templates or parse legacy prose as if it were a verified example.
    for (const module of ['examples', 'usage', 'grammar']) {
      for (const section of card.sections.filter(section => section.module === module)) {
        for (const example of section.examples ?? []) {
          const target = cleanPronunciationTarget(example.english)
          if (target) return [target]
        }
      }
    }
    return []
  }
  return cleanTargets
}

export const selectEnglishPronunciationVoice = (
  voices: readonly SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null => {
  const englishVoices = voices.filter((voice) => ENGLISH_LANGUAGE_PATTERN.test(voice.lang))

  return (
    englishVoices.find((voice) => GOOGLE_VOICE_NAME_PATTERN.test(voice.name)) ??
    englishVoices.find((voice) => AMERICAN_ENGLISH_LANGUAGE_PATTERN.test(voice.lang)) ??
    englishVoices[0] ??
    null
  )
}

export const createPronunciationAudioDataUrl = (
  response: PronunciationAudioResponse
): string => {
  if (
    response.mimeType !== 'audio/mpeg' ||
    response.data.length === 0 ||
    !BASE64_AUDIO_PATTERN.test(response.data)
  ) {
    throw new Error('Pronunciation service returned invalid audio data.')
  }

  return `data:${response.mimeType};base64,${response.data}`
}
