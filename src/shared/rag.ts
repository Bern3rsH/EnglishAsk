import type { RetrievalDiagnostic } from './embedding'
import { MODEL_PROVIDER_OPTIONS, type ModelProvider } from './ai'

export const OPEN_NOTE_ANSWER_SOURCE_CHANNEL = 'english-ask:open-note-answer-source'

export interface NoteAnswerSource {
  sourceId: string
  noteId: string
  noteIdentity: string
  identityKind: 'persisted' | 'filename'
  directoryScopeId: string
  sourceRevision: string
  sourceChunkId: string
  sectionIndex: number
  title: string
  text: string
  quote: string
}

export interface NoteAnswer {
  retrievalDiagnostic?: RetrievalDiagnostic
  status: 'answered' | 'no_evidence' | 'insufficient_evidence'
  answer: string
  sources: NoteAnswerSource[]
  generationCalled: boolean
  modelProvider?: ModelProvider
  model?: string
  retrievedChunkCount: number
  providedSourceCount: number
  omittedChunkCount: number
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const count = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100
const normalizeQuote = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim()

export const isNoteAnswerSource = (value: unknown): value is NoteAnswerSource => {
  if (!record(value)) return false
  return typeof value.sourceId === 'string' && /^S[1-9]\d{0,2}$/.test(value.sourceId) &&
    typeof value.noteId === 'string' && value.noteId.length > 3 && value.noteId.length <= 255 &&
    !/[\/\\\x00-\x1f]/.test(value.noteId) && /\.md$/i.test(value.noteId) &&
    typeof value.noteIdentity === 'string' &&
    ((value.identityKind === 'persisted' && /^uuid:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.noteIdentity)) ||
      (value.identityKind === 'filename' && value.noteIdentity === `filename:${value.noteId}`)) &&
    hash(value.directoryScopeId) && hash(value.sourceRevision) && hash(value.sourceChunkId) &&
    Number.isSafeInteger(value.sectionIndex) && Number(value.sectionIndex) >= 0 && Number(value.sectionIndex) < 500 &&
    typeof value.title === 'string' && value.title.length <= 16_000 &&
    typeof value.text === 'string' && value.text.length <= 16_000 &&
    typeof value.quote === 'string' && value.quote.trim().length > 0 && value.quote.length <= 1000 &&
    normalizeQuote(value.text).includes(normalizeQuote(value.quote))
}

export const isNoteAnswer = (value: unknown): value is NoteAnswer => {
  if (!record(value) || (value.status !== 'answered' && value.status !== 'no_evidence' && value.status !== 'insufficient_evidence') ||
    typeof value.answer !== 'string' || !value.answer.trim() || value.answer.length > 12_000 ||
    typeof value.generationCalled !== 'boolean' || !Array.isArray(value.sources) || value.sources.length > 100 ||
    !value.sources.every(isNoteAnswerSource) ||
    !count(value.retrievedChunkCount) || !count(value.providedSourceCount) || !count(value.omittedChunkCount) ||
    value.retrievedChunkCount !== value.providedSourceCount + value.omittedChunkCount ||
    value.sources.length > value.providedSourceCount ||
    (value.modelProvider !== undefined && !MODEL_PROVIDER_OPTIONS.some(provider => provider.id === value.modelProvider)) ||
    (value.model !== undefined && (typeof value.model !== 'string' || !value.model || value.model.length > 256))) return false
  if (value.retrievalDiagnostic !== undefined && (!record(value.retrievalDiagnostic) ||
    !['bm25', 'hybrid'].includes(String(value.retrievalDiagnostic.mode)) ||
    (value.retrievalDiagnostic.notice !== undefined && (typeof value.retrievalDiagnostic.notice !== 'string' || value.retrievalDiagnostic.notice.length > 300)))) return false
  if (value.status === 'no_evidence') return !value.generationCalled && value.sources.length === 0 && value.retrievedChunkCount === 0
  if (!value.generationCalled || !value.modelProvider || !value.model) return false
  const references: string[] = value.answer.match(/\[S[^\]\r\n]*\]/g) ?? []
  if (value.status === 'insufficient_evidence') return value.sources.length === 0 && references.length === 0
  const sourceIds = value.sources.map(source => source.sourceId)
  return sourceIds.length > 0 && new Set(sourceIds).size === sourceIds.length &&
    references.every(reference => sourceIds.some(id => reference === `[${id}]`)) &&
    sourceIds.every(id => references.includes(`[${id}]`))
}
