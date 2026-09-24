import type { RouterClassification } from '../shared/router'

export const REVIEW_DRAFT_TTL_MS = 5 * 60 * 1000
export const MAX_REVIEW_DRAFTS = 8
export const MAX_REVIEW_DRAFT_CHARACTERS = 256_000

interface CachedDraft {
  fingerprint: string
  output: string
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
  route?: { fingerprint: string; classification: RouterClassification }
}

export class ReviewDraftCache {
  private readonly entries = new Map<string, CachedDraft>()

  private remove(id: string): void {
    const entry = this.entries.get(id)
    if (entry) clearTimeout(entry.timer)
    this.entries.delete(id)
  }

  put(id: string, fingerprint: string, output: string, route?: CachedDraft['route']): void {
    this.remove(id)
    if (output.length + (route ? JSON.stringify(route).length : 0) > MAX_REVIEW_DRAFT_CHARACTERS) return
    while (this.entries.size >= MAX_REVIEW_DRAFTS) {
      this.remove(this.entries.keys().next().value!)
    }
    const timer = setTimeout(() => this.remove(id), REVIEW_DRAFT_TTL_MS)
    timer.unref?.()
    this.entries.set(id, { fingerprint, output, expiresAt: Date.now() + REVIEW_DRAFT_TTL_MS, timer,
      ...(route ? { route: structuredClone(route) } : {}) })
  }

  getClassification(id: string, fingerprint: string): RouterClassification | undefined {
    const entry = this.entries.get(id)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now() || entry.route?.fingerprint !== fingerprint) {
      this.remove(id)
      return undefined
    }
    // Route and draft share one lifetime; callers cannot mutate the stored route.
    return structuredClone(entry.route.classification)
  }

  take(id: string, fingerprint: string): string | undefined {
    const entry = this.entries.get(id)
    this.remove(id)
    return entry && entry.expiresAt > Date.now() && entry.fingerprint === fingerprint
      ? entry.output : undefined
  }
}
