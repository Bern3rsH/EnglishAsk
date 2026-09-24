import { randomUUID } from 'node:crypto'
import type { ModelProvider } from '../shared/ai'

export type ModelRequestPurpose = 'routing' | 'card-generation' | 'grammar-review' | 'answer' | 'notes-planning' | 'notes-formatting' | 'anki-drafts'

export const measureModelRequest = async <T>(
  metadata: { purpose: ModelRequestPurpose; modelProvider: ModelProvider; modelName: string; signal?: AbortSignal },
  request: () => Promise<T>
): Promise<T> => {
  const details = { callId: randomUUID(), stage: metadata.purpose,
    provider: metadata.modelProvider, model: metadata.modelName }
  const startedAt = performance.now()
  console.info('EnglishAsk model request started', details)
  let outcome: 'success' | 'failed' | 'cancelled' = 'success'
  try {
    return await request()
  } catch (error) {
    outcome = metadata.signal?.aborted ? 'cancelled' : 'failed'
    throw error
  } finally {
    console.info('EnglishAsk model request finished', { ...details, outcome,
      elapsedMs: Math.round(performance.now() - startedAt) })
  }
}
