import { readFile, writeFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import type { ModelProvider } from '../shared/ai'
import { classifyEnglishRequest } from './router-classifier'
import { generateKnowledgeCard } from './knowledge-card-service'

const TEST_TIMEOUT_MS = 180_000
it.skipIf(process.env.TIMEOUT_DIAGNOSTIC_LIVE !== '1')('diagnoses present continuous request timing', async () => {
  const settings = JSON.parse(await readFile(process.env.COVERAGE_REGRESSION_SETTINGS_PATH!, 'utf8')) as {
    modelProvider: ModelProvider; apiKeys: Record<string, string>; models: Record<string, string>
  }
  const events: unknown[] = []
  const nativeFetch = globalThis.fetch
  const started = performance.now()
  let attempt = 0
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const id = ++attempt
    const start = performance.now()
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
    events.push({ event: 'http-start', id, model: body.model, reasoningEffort: body.reasoning_effort,
      stream: body.stream ?? false, requestBytes: typeof init?.body === 'string' ? Buffer.byteLength(init.body) : null,
      elapsedMs: Math.round(start - started) })
    try {
      const response = await nativeFetch(input, init)
      events.push({ event: 'http-headers', id, status: response.status, elapsedMs: Math.round(performance.now() - start) })
      // Non-streaming SDK calls already wait for the complete body; inspect a clone, not the original.
      const text = await response.clone().text()
      let usage: unknown
      try { usage = JSON.parse(text).usage } catch { /* Non-JSON error bodies are not logged. */ }
      events.push({ event: 'http-body', id, elapsedMs: Math.round(performance.now() - start), bytes: Buffer.byteLength(text), usage })
      return response
    } catch (error) {
      events.push({ event: 'http-error', id, elapsedMs: Math.round(performance.now() - start),
        name: error instanceof Error ? error.name : 'unknown', aborted: init?.signal?.aborted ?? false })
      throw error
    }
  })
  const infoSpy = vi.spyOn(console, 'info').mockImplementation((event, details) => events.push({ event, details }))
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((event, details) => events.push({ event, details }))
  const connection = { apiKey: settings.apiKeys[settings.modelProvider], modelName: settings.models[settings.modelProvider],
    modelProvider: settings.modelProvider, signal: AbortSignal.timeout(TEST_TIMEOUT_MS - 5_000) }
  const question = '现在进行时'
  let outcome: unknown
  try {
    const classification = await classifyEnglishRequest({ ...connection, request: { requestId: 'timeout-diagnostic', question, history: [] } })
    const card = await generateKnowledgeCard({ ...connection, answerLanguage: 'zh',
      request: { sourceQuestion: question, classification, recentContext: [] } })
    outcome = { classification, card }
    expect(card.cardType).toBe('grammar_concept')
  } catch (error) {
    outcome = { error: error instanceof Error ? error.message : 'unknown' }
    throw error
  } finally {
    fetchSpy.mockRestore()
    infoSpy.mockRestore()
    warnSpy.mockRestore()
    await writeFile(process.env.TIMEOUT_DIAGNOSTIC_OUTPUT_PATH!, JSON.stringify({ question, elapsedMs: Math.round(performance.now() - started), events, outcome }, null, 2))
  }
}, TEST_TIMEOUT_MS)
