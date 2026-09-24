import { readFile } from 'node:fs/promises'
import { expect, it, vi, afterEach } from 'vitest'
import type { ModelProvider } from '../shared/ai'
import type { RouterClassification } from '../shared/router'
import { formatCardSection, validateGeneratedExamples } from '../shared/card-examples'
import { generateKnowledgeCard } from './knowledge-card-service'
import * as providerAdapters from './provider-adapters'

const LIVE_TIMEOUT_MS = 120_000
afterEach(() => vi.restoreAllMocks())

it.skipIf(process.env.CARD_EXAMPLES_LIVE !== '1').each(['zh', 'en'] as const)(
  'live paired examples: %s',
  async answerLanguage => {
    const settingsPath = process.env.CARD_EXAMPLES_SETTINGS_PATH
    expect(settingsPath).toBeTruthy()
    const settings = JSON.parse(await readFile(settingsPath!, 'utf8')) as {
      modelProvider: ModelProvider
      apiKeys: Partial<Record<ModelProvider, string>>
      models: Partial<Record<ModelProvider, string>>
    }
    const apiKey = settings.apiKeys[settings.modelProvider]
    const modelName = settings.models[settings.modelProvider]
    expect(Boolean(apiKey && modelName)).toBe(true)
    const classification: RouterClassification = {
      inputType: 'pattern', structureType: 'pattern',
      targetText: 'ask sb to do sth', targets: ['ask sb to do sth'], focusText: '',
      intent: 'explain_grammar', modules: ['meaning', 'grammar', 'usage', 'examples'],
      confidence: 1, needsClarification: false, clarificationQuestion: '', responseMode: 'card'
    }
    const providerSpy = vi.spyOn(providerAdapters, 'generateProviderText')
    const card = await generateKnowledgeCard({
      apiKey: apiKey!, modelName: modelName!, modelProvider: settings.modelProvider,
      answerLanguage, signal: AbortSignal.timeout(LIVE_TIMEOUT_MS - 5_000),
      request: {
        sourceQuestion: answerLanguage === 'zh'
          ? '讲解 ask sb to do sth，给三个例句。'
          : 'Explain how to use ask sb to do sth, with examples.',
        recentContext: [], classification
      }
    }).catch(async error => {
      const output = await providerSpy.mock.results[0]?.value
      let fields: unknown = 'No structured provider output'
      try {
        const parsed = JSON.parse(output)
        fields = parsed.sections?.map((section: { module: string; examples?: { english?: unknown; translation?: unknown }[] }) => ({
          module: section.module,
          examples: section.examples?.map(example => ({
            englishType: typeof example.english,
            englishLength: typeof example.english === 'string' ? example.english.length : null,
            translationType: typeof example.translation,
            translationLength: typeof example.translation === 'string' ? example.translation.length : null
          }))
        }))
      } catch { /* Preserve the original failure when the provider did not return JSON. */ }
      throw new Error(String(error) + '\nExample field diagnostics: ' + JSON.stringify(fields))
    })
    expect(() => validateGeneratedExamples(card, answerLanguage === 'zh', true)).not.toThrow()
    const examples = card.sections.find(section => section.module === 'examples')!
    expect(examples.content).toBe('')
    expect(examples.examples).toHaveLength(answerLanguage === 'zh' ? 3 : 2)
    for (const section of card.sections) {
      const markdown = formatCardSection(section)
      for (const example of section.examples ?? []) {
        expect(markdown).toContain(example.english)
        if (answerLanguage === 'zh') expect(markdown).toContain(example.translation!)
      }
    }
  },
  LIVE_TIMEOUT_MS
)
