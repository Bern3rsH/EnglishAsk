import type { GenerateAnkiDraftsRequest, ExportAnkiCardsRequest, ExportedAnkiCards, AnkiNoteRequest, SaveAnkiDraftsRequest, AnkiResult, AnkiDraftSet, LoadedAnkiDrafts } from '../../shared/anki'
import type {
  AskEnglishRequest,
  AskEnglishResult,
  CancelAskEnglishRequest,
  CancelAskEnglishResult,
  CreateNoteRequest,
  DeleteNoteResult,
  FormatAskNoteRequest,
  FormatAskNoteResult,
  ListProviderModelsRequest,
  ModelProvider,
  NoteDocumentResult,
  NoteStorageSettingsResult,
  PlanAskNotesRequest,
  PlanAskNotesResult,
  PronunciationAudioRequest,
  PronunciationAudioResult,
  ProviderModelsResult,
  RenameNoteRequest,
  NotesListResult,
  SaveNoteImageRequest,
  SaveNoteImageResult,
  SaveNoteRequest,
  SaveSettingsRequest,
  SettingsResult,
  TelemetryEventName,
  TelemetryEventProperties
} from '../../shared/ai'

declare global {
  interface ImportMetaEnv {
    readonly DEV: boolean
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }

  interface Window {
    englishAsk?: {
      exportAnkiCards: (request: ExportAnkiCardsRequest) => Promise<AnkiResult<ExportedAnkiCards>>
      generateAnkiDrafts: (request: GenerateAnkiDraftsRequest) => Promise<AnkiResult<AnkiDraftSet>>
      loadAnkiDrafts: (request: AnkiNoteRequest) => Promise<AnkiResult<LoadedAnkiDrafts>>
      saveAnkiDrafts: (request: SaveAnkiDraftsRequest) => Promise<AnkiResult<AnkiDraftSet>>
      platform: string
      askEnglish: (request: AskEnglishRequest) => Promise<AskEnglishResult>
      cancelAskEnglish: (request: CancelAskEnglishRequest) => Promise<CancelAskEnglishResult>
      getSettings: () => Promise<SettingsResult>
      getPronunciationAudio: (
        request: PronunciationAudioRequest
      ) => Promise<PronunciationAudioResult>
      saveSettings: (request: SaveSettingsRequest) => Promise<SettingsResult>
      deleteProviderApiKey: (provider: ModelProvider) => Promise<SettingsResult>
      saveNoteImage: (request: SaveNoteImageRequest) => Promise<SaveNoteImageResult>
      listNotes: () => Promise<NotesListResult>
      createNote: (request: CreateNoteRequest) => Promise<NoteDocumentResult>
      planAskNotes: (request: PlanAskNotesRequest) => Promise<PlanAskNotesResult>
      formatAskNote: (request: FormatAskNoteRequest) => Promise<FormatAskNoteResult>
      getNote: (noteId: string) => Promise<NoteDocumentResult>
      saveNote: (request: SaveNoteRequest) => Promise<NoteDocumentResult>
      renameNote: (request: RenameNoteRequest) => Promise<NoteDocumentResult>
      deleteNote: (noteId: string) => Promise<DeleteNoteResult>
      chooseNoteStorageDirectory: () => Promise<NoteStorageSettingsResult>
      resetNoteStorageDirectory: () => Promise<NoteStorageSettingsResult>
      listProviderModels: (
        request: ListProviderModelsRequest
      ) => Promise<ProviderModelsResult>
      captureTelemetryEvent: (
        eventName: TelemetryEventName,
        properties?: TelemetryEventProperties
      ) => void
    }
  }
}

export {}
