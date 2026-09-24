import { readFile, writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import type { ModelProvider } from '../shared/ai'
import type { RouterClassification } from '../shared/router'
import { generateKnowledgeCard } from './knowledge-card-service'

const LIVE_TIMEOUT_MS = 180_000
const ABORT_MARGIN_MS = 5_000
const MIN_DUPLICATE_PARAGRAPH_LENGTH = 40

it.skipIf(process.env.CONTENT_QUALITY_LIVE !== '1').each(['zh', 'en'] as const)(
  'live content ownership and tense boundaries: %s', async answerLanguage => {
    const settingsPath = process.env.CONTENT_QUALITY_SETTINGS_PATH
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
      inputType: 'grammar_concept', structureType: 'abstract_concept',
      targetText: 'present perfect', targets: ['present perfect'], focusText: '',
      intent: 'explain_grammar', modules: ['meaning', 'grammar', 'usage', 'examples'],
      confidence: 1, needsClarification: false, clarificationQuestion: '', responseMode: 'card'
    }
    const sourceQuestion = answerLanguage === 'zh'
      ? '讲解现在完成时的含义、结构和用法，以及如何与一般过去时选择，给三个例句。'
      : 'Explain the meaning, structure and usage of the present perfect, including how to choose between it and the past simple. Give three examples.'
    const card = await generateKnowledgeCard({
      apiKey: apiKey!, modelName: modelName!, modelProvider: settings.modelProvider,
      answerLanguage, signal: AbortSignal.timeout(LIVE_TIMEOUT_MS - ABORT_MARGIN_MS),
      request: { sourceQuestion, recentContext: [], classification }
    })
    // Synthetic content only. Inspect semantics separately; lexical checks cannot prove correctness.
    console.info('Content quality live answer', JSON.stringify({ answerLanguage, modelName, sourceQuestion, card }))
    const outputPrefix = process.env.CONTENT_QUALITY_OUTPUT_PREFIX
    if (outputPrefix) {
      await writeFile(`${outputPrefix}-${answerLanguage}.json`,
        JSON.stringify({ answerLanguage, modelName, sourceQuestion, card }, null, 2), 'utf8')
    }
    expect(card.sections.map(section => section.module)).toEqual(classification.modules)
    expect(card.sections.find(section => section.module === 'examples')?.examples).toHaveLength(3)
    const paragraphs = card.sections.flatMap(section => section.content.split(/\n\s*\n/))
      .map(paragraph => paragraph.replace(/\s+/g, ' ').trim())
      .filter(paragraph => paragraph.length >= MIN_DUPLICATE_PARAGRAPH_LENGTH)
    expect(new Set(paragraphs).size).toBe(paragraphs.length)
  }, LIVE_TIMEOUT_MS
)
