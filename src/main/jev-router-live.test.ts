import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { AskEnglishRequest, ModelProvider } from '../shared/ai'
import { classifyEnglishRequest } from './router-classifier'
import { classifyWithJev, compareRouterLabels, type JevRouteLabels } from './jev-router'

const BASELINE_TIMEOUT_MS = 45_000
const SUITE_TIMEOUT_MS = 720_000
const samples: Array<{ name: string; question: string; previous?: string;
  expected: Partial<JevRouteLabels> }> = [
  { name: 'word', question: 'resilient', expected: { inputType: 'word', intent: 'explain_meaning', responseMode: 'card' } },
  { name: 'bare greeting word', question: 'hello', expected: { inputType: 'word', responseMode: 'card' } },
  { name: 'phrase', question: 'take off 是什么意思？', expected: { inputType: 'phrase', intent: 'explain_meaning' } },
  { name: 'collocation', question: 'heavy rain 这个搭配怎么用？', expected: { inputType: 'collocation', intent: 'explain_usage' } },
  { name: 'pattern', question: 'ask sb to do 这个句型怎么用？', expected: { inputType: 'pattern', intent: 'explain_usage' } },
  { name: 'sentence', question: '分析句子结构：She gave me a book.', expected: { inputType: 'sentence', intent: 'analyze_sentence' } },
  { name: 'paragraph', question: '分析这段英文的结构：It was raining. We stayed at home. Then the sun came out.',
    expected: { inputType: 'paragraph', intent: 'analyze_sentence' } },
  { name: 'grammar concept', question: '讲解现在完成时的基本语法。', expected: { inputType: 'grammar_concept', intent: 'explain_grammar' } },
  { name: 'comparison', question: 'say 和 tell 有什么区别？', expected: { inputType: 'comparison', intent: 'compare_difference' } },
  { name: 'translation', question: '翻译成中文：I have finished my work.', expected: { inputType: 'sentence', intent: 'translate' } },
  { name: 'correction', question: '改正这句话的语法错误：She go to school every day.', expected: { intent: 'correct_sentence' } },
  { name: 'polishing', question: '润色这句话，让语气更礼貌：Send me the file now.', expected: { intent: 'polish_expression' } },
  { name: 'follow-up', question: '它怎么读？', previous: 'resilient', expected: { inputType: 'word', intent: 'ask_pronunciation', responseMode: 'card' } },
  { name: 'missing context', question: '它和另一个有什么区别？', expected: { responseMode: 'clarification' } },
  { name: 'conversation', question: '谢谢你的帮助，今天先学到这里。', expected: { responseMode: 'conversational' } }
]

// This file is the only consumer of Jev in the project. No production route is changed.
it.skipIf(process.env.JEV_ROUTER_LIVE !== '1')('compares Jev with the unchanged Router on synthetic requests', async () => {
  const settingsPath = process.env.JEV_ROUTER_SETTINGS_PATH
  if (!settingsPath) throw new Error('Set JEV_ROUTER_SETTINGS_PATH to the existing application settings file.')
  const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as {
    modelProvider: ModelProvider; apiKeys: Partial<Record<ModelProvider, string>>;
    models: Partial<Record<ModelProvider, string>>
  }
  const provider = settings.modelProvider
  const baselineKey = settings.apiKeys[provider]
  const modelName = settings.models[provider]
  const jevKey = process.env.OPENROUTER_API_KEY?.trim() || settings.apiKeys.openrouter
  if (!baselineKey || !modelName || !jevKey) throw new Error('Baseline model credentials and an OpenRouter key are required.')
  const results: unknown[] = []
  let completedPairs = 0
  for (const sample of samples) {
    const request: AskEnglishRequest = { requestId: `jev-comparison-${sample.name}`,
      question: sample.question, history: sample.previous ? [{ id: 'previous', role: 'user',
        content: sample.previous, createdAt: '2026-09-24T00:00:00Z' }] : [] }
    const start = performance.now()
    const [baseline, jev] = await Promise.allSettled([
      classifyEnglishRequest({ apiKey: baselineKey, modelName, modelProvider: provider, request,
        signal: AbortSignal.timeout(BASELINE_TIMEOUT_MS) })
        .then(classification => ({ classification, elapsedMs: Math.round(performance.now() - start) })),
      classifyWithJev({ apiKey: jevKey, request })
    ])
    const failuresAgainstExpected = (labels: JevRouteLabels) =>
      Object.entries(sample.expected).filter(([field, expected]) => labels[field as keyof JevRouteLabels] !== expected)
        .map(([field]) => field)
    const row = { name: sample.name, question: sample.question, previous: sample.previous,
      expected: sample.expected,
      baseline: baseline.status === 'fulfilled' ? baseline.value : { error: 'Baseline request failed; no raw error logged.' },
      jev: jev.status === 'fulfilled' ? jev.value : { error: 'Jev request failed; no raw error logged.' },
      ...(baseline.status === 'fulfilled' && jev.status === 'fulfilled' ? {
        disagreements: compareRouterLabels(baseline.value.classification, jev.value.labels),
        baselineExpectationFailures: failuresAgainstExpected(baseline.value.classification),
        jevExpectationFailures: failuresAgainstExpected(jev.value.labels)
      } : {}) }
    if (baseline.status === 'fulfilled' && jev.status === 'fulfilled') completedPairs += 1
    results.push(row)
    console.info('Jev routing comparison sample', { name: sample.name, baseline: baseline.status, jev: jev.status })
  }
  const outputPath = join(tmpdir(), `englishask-jev-router-${Date.now()}.json`)
  await writeFile(outputPath, JSON.stringify({ provider, baselineModel: modelName,
    scope: 'Categorical labels only; excludes target extraction, modules and clarification text. Agreement is not accuracy.',
    results }, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  console.info('Jev routing comparison report', outputPath)
  // Semantic differences belong in the report, not an assertion that the baseline is always right.
  expect(completedPairs, 'Inspect the report for transport/schema failures').toBe(samples.length)
}, SUITE_TIMEOUT_MS)
