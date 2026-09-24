import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../shared/ai'
import type { KnowledgeCardSection } from '../../shared/knowledge-card'
import {
  createPronunciationAudioDataUrl,
  getMessagePronunciationTargets,
  getPronunciationPlaybackKey,
  PRONUNCIATION_LANGUAGE,
  PRONUNCIATION_RATE,
  selectEnglishPronunciationVoice
} from './pronunciation'

const appSourcePath = fileURLToPath(new URL('./App.tsx', import.meta.url))
const stylesPath = fileURLToPath(new URL('./styles.css', import.meta.url))

const createAssistantMessage = (
  targetText: string,
  sections: KnowledgeCardSection[] = []
): ChatMessage => ({
  id: 'message-1',
  role: 'assistant',
  content: 'Answer',
  createdAt: '2026-08-30T00:00:00.000Z',
  knowledgeCard: {
    cardType: 'phrase',
    targetText,
    targets: [targetText],
    answer: 'Answer',
    sections
  }
})

const createVoice = (lang: string, name: string): SpeechSynthesisVoice => ({
  default: false,
  lang,
  localService: true,
  name,
  voiceURI: name
})

describe('Ask answer pronunciation', () => {
  it('uses the trimmed target from structured assistant answers only', () => {
    expect(getMessagePronunciationTargets(createAssistantMessage('  cold turkey  '))).toEqual(
      ['cold turkey']
    )
    expect(
      getMessagePronunciationTargets({
        ...createAssistantMessage('cold turkey'),
        role: 'user'
      })
    ).toEqual([])
    expect(
      getMessagePronunciationTargets({
        ...createAssistantMessage('cold turkey'),
        knowledgeCard: undefined
      })
    ).toEqual([])
    expect(getMessagePronunciationTargets(createAssistantMessage('   '))).toEqual([])
  })

  it('disables pronunciation for a translation intent even without a translation section', () => {
    const message = createAssistantMessage('medicine')
    message.routerDiagnostic = {
      status: 'success',
      classification: {
        inputType: 'word',
        structureType: 'single_word',
        targetText: 'medicine',
        targets: ['medicine'],
        focusText: '',
        intent: 'translate',
        modules: ['meaning'],
        confidence: 1,
        needsClarification: false,
        clarificationQuestion: '',
        responseMode: 'card'
      }
    }

    expect(getMessagePronunciationTargets(message)).toEqual([])
  })

  it.each([undefined, { status: 'error', message: '分类器 unavailable' } as const])(
    'disables pronunciation for stored translation sections without successful diagnostics: %s',
    (routerDiagnostic) => {
      const message = {
        ...createAssistantMessage('medicine', [{ module: 'translation', content: 'Translation' }]),
        routerDiagnostic
      }
      const originalMessage = structuredClone(message)

      expect(getMessagePronunciationTargets(message)).toEqual([])
      expect(message).toEqual(originalMessage)
    }
  )

  it('preserves pronunciation for non-translation answers including phonetic sections', () => {
    expect(getMessagePronunciationTargets(createAssistantMessage('test', [
      { module: 'meaning', content: 'An examination.' },
      { module: 'phonetic', content: '- **UK/US:** /test/' }
    ]))).toEqual(['test'])
  })

  it('uses learning targets, never the display title', () => {
    const message = createAssistantMessage('take off 表示脱衣服时的代词位置')
    message.knowledgeCard!.targets = ['take off']
    expect(getMessagePronunciationTargets(message)).toEqual(['take off'])
    message.knowledgeCard!.targetText = '现在完成时 (present perfect)'
    message.knowledgeCard!.cardType = 'grammar_concept'
    message.knowledgeCard!.targets = ['present perfect']
    expect(getMessagePronunciationTargets(message)).toEqual(['present perfect'])
    message.knowledgeCard!.targets = ['现在完成时']
    expect(getMessagePronunciationTargets(message)).toEqual([])
  })

  it('returns separate deduplicated comparison targets and independent playback keys', () => {
    const message = createAssistantMessage('say vs tell vs speak vs talk')
    message.knowledgeCard!.cardType = 'comparison'
    message.knowledgeCard!.targets = ['say', 'tell', 'speak', 'talk', 'say']
    expect(getMessagePronunciationTargets(message)).toEqual(['say', 'tell', 'speak', 'talk'])
    expect(getPronunciationPlaybackKey(message.id, 'say')).not.toBe(getPronunciationPlaybackKey(message.id, 'tell'))
    expect(getPronunciationPlaybackKey('other', 'say')).not.toBe(getPronunciationPlaybackKey(message.id, 'say'))
    expect(getPronunciationPlaybackKey(message.id, 'say')).toBe(getPronunciationPlaybackKey(message.id, 'say'))
  })

  it.each(['sb', 'sth', 'ask sb to do sth', 'say vs tell', '中文 title', 'https://example.com', '<script>test</script>', 'x'.repeat(1001)])(
    'does not send unsafe or placeholder text to pronunciation: %s', target => {
      expect(getMessagePronunciationTargets(createAssistantMessage(target))).toEqual([])
    }
  )

  it('speaks a real structured example for a pattern without changing the card', () => {
    const message = createAssistantMessage('ask sb to do sth', [
      { module: 'grammar', content: '结构', examples: [{ english: 'He asked me to leave.' }] },
      { module: 'examples', content: '', examples: [
        { english: 'ask sb to do sth' },
        { english: 'She **asked** me to wait.', translation: '她让我等一下。' }
      ] }
    ])
    message.knowledgeCard!.cardType = 'pattern'
    const original = structuredClone(message)
    expect(getMessagePronunciationTargets(message)).toEqual(['She asked me to wait.'])
    expect(message).toEqual(original)
    message.knowledgeCard!.sections = [{ module: 'examples', content: '1. She asked me to wait.' }]
    expect(getMessagePronunciationTargets(message)).toEqual([])
  })

  it('hides pattern playback when only known mistake examples exist', () => {
    const message = createAssistantMessage('ask somebody to do something', [
      { module: 'common_mistakes', content: '', examples: [{ english: 'She asked I to wait.' }] }
    ])
    message.knowledgeCard!.cardType = 'pattern'
    expect(getMessagePronunciationTargets(message)).toEqual([])
  })

  it('prefers a Google English fallback voice, then American English', () => {
    const britishVoice = createVoice('en-GB', 'British')
    const americanVoice = createVoice('en-US', 'American')
    const googleVoice = createVoice('en-GB', 'Google UK English Female')
    const chineseVoice = createVoice('zh-CN', 'Chinese')

    expect(
      selectEnglishPronunciationVoice([
        britishVoice,
        chineseVoice,
        americanVoice,
        googleVoice
      ])
    ).toBe(googleVoice)
    expect(selectEnglishPronunciationVoice([britishVoice, americanVoice])).toBe(
      americanVoice
    )
    expect(selectEnglishPronunciationVoice([chineseVoice, britishVoice])).toBe(
      britishVoice
    )
    expect(selectEnglishPronunciationVoice([chineseVoice])).toBeNull()
  })

  it('uses a measured English speech configuration', () => {
    expect(PRONUNCIATION_LANGUAGE).toBe('en-US')
    expect(PRONUNCIATION_RATE).toBeGreaterThanOrEqual(0.8)
    expect(PRONUNCIATION_RATE).toBeLessThanOrEqual(1)
  })

  it('creates a validated MP3 data URL for neural pronunciation', () => {
    expect(
      createPronunciationAudioDataUrl({
        data: 'YWJjZA==',
        mimeType: 'audio/mpeg'
      })
    ).toBe('data:audio/mpeg;base64,YWJjZA==')
    expect(() =>
      createPronunciationAudioDataUrl({ data: '', mimeType: 'audio/mpeg' })
    ).toThrow('Pronunciation service returned invalid audio data.')
  })

  it('wires an accessible play and stop control without changing Markdown content', async () => {
    const [appSource, styles] = await Promise.all([
      readFile(appSourcePath, 'utf8'),
      readFile(stylesPath, 'utf8')
    ])

    expect(appSource).toContain('getMessagePronunciationTargets(message)')
    expect(appSource).toContain('pronunciationTargets.map(pronunciationTarget =>')
    expect(appSource).toContain('!getMessagePronunciationTargets(message).includes(targetText)')
    expect(appSource).toContain('void togglePronunciation(message, pronunciationTarget)')
    expect(appSource).toContain('speakingPronunciationId === getPronunciationPlaybackKey(message.id, pronunciationTarget)')
    expect(appSource).toContain('englishAskBridge.getPronunciationAudio({ text: targetText })')
    expect(appSource).toContain('createPronunciationAudioDataUrl(result.data)')
    expect(appSource).toContain('Neural pronunciation unavailable; using system voice')
    expect(appSource).toContain("'播放'} ${pronunciationTarget} 的发音")
    expect(appSource).toContain('<Volume2 aria-hidden="true"')
    expect(appSource).toContain(
      '<Pause aria-hidden="true" size={14} strokeWidth={1.8} />'
    )
    expect(appSource).not.toContain('<Pause aria-hidden="true" fill=')
    expect(appSource).not.toContain('<Square aria-hidden="true"')
    expect(appSource).toContain('<MarkdownContent content={getMessageMarkdownContent(message)} />')
    expect(styles).toMatch(
      /\.messagePronunciation button\s*{[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*background:\s*transparent;/s
    )
  })
})
