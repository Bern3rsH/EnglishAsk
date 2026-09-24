import type { ModelProvider } from './ai'

export const GENERATE_ANKI_DRAFTS_CHANNEL = 'english-ask:generate-anki-drafts'
export const LOAD_ANKI_DRAFTS_CHANNEL = 'english-ask:load-anki-drafts'
export const SAVE_ANKI_DRAFTS_CHANNEL = 'english-ask:save-anki-drafts'
export const EXPORT_ANKI_CARDS_CHANNEL = 'english-ask:export-anki-cards'
export const MAX_ANKI_CARDS = 20
export const MAX_ANKI_FRONT_LENGTH = 1_000
export const MAX_ANKI_TEXT_LENGTH = 3_000
export const MAX_ANKI_TAGS = 10
export const MAX_ANKI_TAG_LENGTH = 64

export interface AnkiCardContent {
  front: string
  back: string
  explanation: string
  tags: string[]
}

export interface AnkiDraftCard extends AnkiCardContent {
  id: string
  selected: boolean
}

export interface AnkiDraftSet {
  version: 1
  sourceNoteId: string
  sourceRevision: string
  sourceTitle: string
  revision: string
  cards: AnkiDraftCard[]
}

export interface AnkiNoteRequest {
  noteId: string
  expectedMarkdown: string
  expectedDirectory: string
}

export interface GenerateAnkiDraftsRequest extends AnkiNoteRequest {
  modelProvider: ModelProvider
  modelName: string
}

export interface SaveAnkiDraftsRequest extends AnkiNoteRequest {
  drafts: AnkiDraftSet
  expectedDraftRevision: string | null
}

export interface ExportAnkiCardsRequest extends AnkiNoteRequest {
  expectedDraftRevision: string
}

export type ExportedAnkiCards = { cancelled: true } | { cancelled: false; filePath: string; count: number }

export type AnkiResult<T> = { ok: true; data: T } | { ok: false; error: string }
export interface LoadedAnkiDrafts { drafts: AnkiDraftSet | null; stale: boolean }

function record(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('卡片数据格式无效。')
}

const textField = (value: unknown, maximum: number, required = true): string => {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) {
    throw new Error('卡片字段为空或超过长度限制。')
  }
  return value.trim()
}

export const parseAnkiCardContent = (value: unknown): AnkiCardContent => {
  record(value)
  if (!Array.isArray(value.tags) || value.tags.length > MAX_ANKI_TAGS) throw new Error('卡片标签格式无效。')
  const tags = [...new Set(value.tags.map(tag => textField(tag, MAX_ANKI_TAG_LENGTH)))]
  if (tags.some(tag => /\s/.test(tag))) throw new Error('每个卡片标签不能包含空格。')
  return {
    front: textField(value.front, MAX_ANKI_FRONT_LENGTH),
    back: textField(value.back, MAX_ANKI_TEXT_LENGTH),
    explanation: textField(value.explanation, MAX_ANKI_TEXT_LENGTH, false),
    tags
  }
}

export const parseAnkiDraftSet = (value: unknown): AnkiDraftSet => {
  record(value)
  if (value.version !== 1 || !Array.isArray(value.cards) || !value.cards.length || value.cards.length > MAX_ANKI_CARDS) {
    throw new Error('卡片草稿版本或数量无效。')
  }
  const cards = value.cards.map(card => {
    record(card)
    if (typeof card.selected !== 'boolean') throw new Error('卡片勾选状态无效。')
    return { ...parseAnkiCardContent(card), id: textField(card.id, 80), selected: card.selected }
  })
  if (new Set(cards.map(card => card.id)).size !== cards.length) throw new Error('卡片 ID 重复。')
  const sourceNoteId = textField(value.sourceNoteId, 80)
  const sourceRevision = textField(value.sourceRevision, 64)
  if (!/^[0-9a-f-]{36}$/i.test(sourceNoteId) || !/^[0-9a-f]{64}$/.test(sourceRevision)) {
    throw new Error('卡片来源格式无效。')
  }
  return { version: 1, sourceNoteId, sourceRevision, cards,
    sourceTitle: textField(value.sourceTitle, 255), revision: textField(value.revision, 80) }
}
