import { contextBridge, ipcRenderer } from 'electron'
import { EXPORT_ANKI_CARDS_CHANNEL, type ExportAnkiCardsRequest, type ExportedAnkiCards, GENERATE_ANKI_DRAFTS_CHANNEL, LOAD_ANKI_DRAFTS_CHANNEL, SAVE_ANKI_DRAFTS_CHANNEL,
  type GenerateAnkiDraftsRequest, type AnkiNoteRequest, type SaveAnkiDraftsRequest, type AnkiResult, type AnkiDraftSet, type LoadedAnkiDrafts } from '../shared/anki'
import {
  ASK_ENGLISH_CHANNEL,
  CANCEL_ASK_ENGLISH_CHANNEL,
  CAPTURE_TELEMETRY_EVENT_CHANNEL,
  CHOOSE_NOTE_STORAGE_DIRECTORY_CHANNEL,
  CREATE_NOTE_CHANNEL,
  DELETE_NOTE_CHANNEL,
  DELETE_PROVIDER_API_KEY_CHANNEL,
  FORMAT_ASK_NOTE_CHANNEL,
  GET_NOTE_CHANNEL,
  GET_PRONUNCIATION_AUDIO_CHANNEL,
  GET_SETTINGS_CHANNEL,
  LIST_PROVIDER_MODELS_CHANNEL,
  LIST_NOTES_CHANNEL,
  PLAN_ASK_NOTES_CHANNEL,
  RENAME_NOTE_CHANNEL,
  RESET_NOTE_STORAGE_DIRECTORY_CHANNEL,
  SAVE_NOTE_IMAGE_CHANNEL,
  SAVE_NOTE_CHANNEL,
  SAVE_SETTINGS_CHANNEL,
  type AskEnglishRequest,
  type AskEnglishResult,
  type CancelAskEnglishRequest,
  type CancelAskEnglishResult,
  type CreateNoteRequest,
  type DeleteNoteResult,
  type FormatAskNoteRequest,
  type FormatAskNoteResult,
  type ListProviderModelsRequest,
  type ModelProvider,
  type NoteDocumentResult,
  type NoteStorageSettingsResult,
  type PlanAskNotesRequest,
  type PlanAskNotesResult,
  type PronunciationAudioRequest,
  type PronunciationAudioResult,
  type ProviderModelsResult,
  type RenameNoteRequest,
  type NotesListResult,
  type SaveNoteImageRequest,
  type SaveNoteImageResult,
  type SaveNoteRequest,
  type SaveSettingsRequest,
  type SettingsResult,
  type TelemetryEventName,
  type TelemetryEventProperties
} from '../shared/ai'

contextBridge.exposeInMainWorld('englishAsk', {
  exportAnkiCards: (request: ExportAnkiCardsRequest): Promise<AnkiResult<ExportedAnkiCards>> => ipcRenderer.invoke(EXPORT_ANKI_CARDS_CHANNEL, request),
  generateAnkiDrafts: (request: GenerateAnkiDraftsRequest): Promise<AnkiResult<AnkiDraftSet>> => ipcRenderer.invoke(GENERATE_ANKI_DRAFTS_CHANNEL, request),
  loadAnkiDrafts: (request: AnkiNoteRequest): Promise<AnkiResult<LoadedAnkiDrafts>> => ipcRenderer.invoke(LOAD_ANKI_DRAFTS_CHANNEL, request),
  saveAnkiDrafts: (request: SaveAnkiDraftsRequest): Promise<AnkiResult<AnkiDraftSet>> => ipcRenderer.invoke(SAVE_ANKI_DRAFTS_CHANNEL, request),
  platform: process.platform,
  askEnglish: (request: AskEnglishRequest): Promise<AskEnglishResult> => {
    return ipcRenderer.invoke(ASK_ENGLISH_CHANNEL, request)
  },
  cancelAskEnglish: (request: CancelAskEnglishRequest): Promise<CancelAskEnglishResult> => {
    return ipcRenderer.invoke(CANCEL_ASK_ENGLISH_CHANNEL, request)
  },
  getSettings: (): Promise<SettingsResult> => {
    return ipcRenderer.invoke(GET_SETTINGS_CHANNEL)
  },
  getPronunciationAudio: (
    request: PronunciationAudioRequest
  ): Promise<PronunciationAudioResult> => {
    return ipcRenderer.invoke(GET_PRONUNCIATION_AUDIO_CHANNEL, request)
  },
  saveSettings: (request: SaveSettingsRequest): Promise<SettingsResult> => {
    return ipcRenderer.invoke(SAVE_SETTINGS_CHANNEL, request)
  },
  deleteProviderApiKey: (provider: ModelProvider): Promise<SettingsResult> => {
    return ipcRenderer.invoke(DELETE_PROVIDER_API_KEY_CHANNEL, provider)
  },
  saveNoteImage: (request: SaveNoteImageRequest): Promise<SaveNoteImageResult> => {
    return ipcRenderer.invoke(SAVE_NOTE_IMAGE_CHANNEL, request)
  },
  listNotes: (): Promise<NotesListResult> => {
    return ipcRenderer.invoke(LIST_NOTES_CHANNEL)
  },
  createNote: (request: CreateNoteRequest): Promise<NoteDocumentResult> => {
    return ipcRenderer.invoke(CREATE_NOTE_CHANNEL, request)
  },
  planAskNotes: (request: PlanAskNotesRequest): Promise<PlanAskNotesResult> => {
    return ipcRenderer.invoke(PLAN_ASK_NOTES_CHANNEL, request)
  },
  formatAskNote: (request: FormatAskNoteRequest): Promise<FormatAskNoteResult> => {
    return ipcRenderer.invoke(FORMAT_ASK_NOTE_CHANNEL, request)
  },
  getNote: (noteId: string): Promise<NoteDocumentResult> => {
    return ipcRenderer.invoke(GET_NOTE_CHANNEL, noteId)
  },
  saveNote: (request: SaveNoteRequest): Promise<NoteDocumentResult> => {
    return ipcRenderer.invoke(SAVE_NOTE_CHANNEL, request)
  },
  renameNote: (request: RenameNoteRequest): Promise<NoteDocumentResult> => {
    return ipcRenderer.invoke(RENAME_NOTE_CHANNEL, request)
  },
  deleteNote: (noteId: string): Promise<DeleteNoteResult> => {
    return ipcRenderer.invoke(DELETE_NOTE_CHANNEL, noteId)
  },
  chooseNoteStorageDirectory: (): Promise<NoteStorageSettingsResult> => {
    return ipcRenderer.invoke(CHOOSE_NOTE_STORAGE_DIRECTORY_CHANNEL)
  },
  resetNoteStorageDirectory: (): Promise<NoteStorageSettingsResult> => {
    return ipcRenderer.invoke(RESET_NOTE_STORAGE_DIRECTORY_CHANNEL)
  },
  listProviderModels: (
    request: ListProviderModelsRequest
  ): Promise<ProviderModelsResult> => {
    return ipcRenderer.invoke(LIST_PROVIDER_MODELS_CHANNEL, request)
  },
  captureTelemetryEvent: (
    eventName: TelemetryEventName,
    properties?: TelemetryEventProperties
  ): void => {
    ipcRenderer.send(CAPTURE_TELEMETRY_EVENT_CHANNEL, eventName, properties)
  }
})
