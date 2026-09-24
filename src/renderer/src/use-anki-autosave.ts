import { useCallback, useEffect, useRef, useState } from 'react'
import { parseAnkiDraftSet, type AnkiDraftSet, type AnkiNoteRequest } from '../../shared/anki'

export const ANKI_AUTOSAVE_DELAY_MS = 600

export function useAnkiAutosave(request: AnkiNoteRequest, enabled: boolean) {
  const [drafts, setDrafts] = useState<AnkiDraftSet | null>(null)
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const current = useRef<{ drafts: AnkiDraftSet | null; tags: Record<string, string>; version: number; savedVersion: number; revision: string | null }>({
    drafts: null, tags: {}, version: 0, savedVersion: 0, revision: null
  })
  const pending = useRef<Promise<AnkiDraftSet | null> | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = (value: AnkiDraftSet | null) => {
    current.current = { drafts: value, tags: {}, version: 0, savedVersion: 0, revision: value?.revision ?? null }
    setDrafts(value); setTagInputs({}); setDirty(false); setSaveError(null)
  }
  const changed = () => {
    current.current.version += 1
    setDirty(true); setSaveError(null)
  }
  const replace = (value: AnkiDraftSet) => {
    current.current.drafts = value; current.current.tags = {}
    setDrafts(value); setTagInputs({}); changed()
  }
  const update = (updater: (value: AnkiDraftSet) => AnkiDraftSet) => {
    if (!current.current.drafts) return
    current.current.drafts = updater(current.current.drafts)
    setDrafts(current.current.drafts); changed()
  }
  const editTags = (id: string, text: string) => {
    current.current.tags = { ...current.current.tags, [id]: text }
    setTagInputs(current.current.tags); changed()
  }

  const flush = useCallback((): Promise<AnkiDraftSet | null> => {
    if (pending.current) return pending.current
    const operation = async () => {
      setSaving(true)
      try {
        while (current.current.drafts && current.current.savedVersion < current.current.version) {
          const snapshot = current.current
          const version = snapshot.version
          const drafts = parseAnkiDraftSet({ ...snapshot.drafts, cards: snapshot.drafts!.cards.map(card => ({ ...card,
            tags: (snapshot.tags[card.id] ?? card.tags.join(' ')).split(/[\s,，]+/).filter(Boolean) })) })
          if (!window.englishAsk?.saveAnkiDrafts) throw new Error('请重启桌面应用后重试。')
          const result = await window.englishAsk.saveAnkiDrafts({ ...request, drafts, expectedDraftRevision: snapshot.revision })
          if (!result.ok) throw new Error(result.error)
          current.current.revision = result.data.revision
          current.current.savedVersion = version
          if (current.current.version === version) {
            current.current.drafts = result.data; current.current.tags = {}
            if (alive.current) { setDrafts(result.data); setTagInputs({}); setDirty(false) }
          }
        }
        if (alive.current) setSaveError(null)
        return current.current.drafts
      } catch (failure) {
        if (alive.current) setSaveError(failure instanceof Error ? failure.message : '自动保存失败，修改仍保留在这里。')
        return null
      } finally {
        if (alive.current) setSaving(false)
      }
    }
    pending.current = operation().finally(() => { pending.current = null })
    return pending.current
  }, [request])

  useEffect(() => {
    if (!enabled || !dirty || !drafts) return
    const timer = window.setTimeout(() => { void flush() }, ANKI_AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [drafts, tagInputs, dirty, enabled, flush])

  return { drafts, tagInputs, dirty, saving, saveError, load, replace, update, editTags, flush }
}
