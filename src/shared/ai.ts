import type { KnowledgeCard } from './knowledge-card'
import type { JevChannel } from './jev'
import type { RouterDiagnostic } from './router'

export const ASK_ENGLISH_CHANNEL = 'english-ask:ask'
export const CANCEL_ASK_ENGLISH_CHANNEL = 'english-ask:cancel-ask'
export const GET_SETTINGS_CHANNEL = 'english-ask:get-settings'
export const GET_PRONUNCIATION_AUDIO_CHANNEL = 'english-ask:get-pronunciation-audio'
export const SAVE_SETTINGS_CHANNEL = 'english-ask:save-settings'
export const DELETE_PROVIDER_API_KEY_CHANNEL = 'english-ask:delete-provider-api-key'
export const LIST_PROVIDER_MODELS_CHANNEL = 'english-ask:list-provider-models'
export const SAVE_NOTE_IMAGE_CHANNEL = 'english-ask:save-note-image'
export const LIST_NOTES_CHANNEL = 'english-ask:list-notes'
export const CREATE_NOTE_CHANNEL = 'english-ask:create-note'
export const PLAN_ASK_NOTES_CHANNEL = 'english-ask:plan-ask-notes'
export const FORMAT_ASK_NOTE_CHANNEL = 'english-ask:format-ask-note'
export const GET_NOTE_CHANNEL = 'english-ask:get-note'
export const SAVE_NOTE_CHANNEL = 'english-ask:save-note'
export const RENAME_NOTE_CHANNEL = 'english-ask:rename-note'
export const DELETE_NOTE_CHANNEL = 'english-ask:delete-note'
export const CHOOSE_NOTE_STORAGE_DIRECTORY_CHANNEL = 'english-ask:choose-note-storage-directory'
export const RESET_NOTE_STORAGE_DIRECTORY_CHANNEL = 'english-ask:reset-note-storage-directory'
export const CAPTURE_TELEMETRY_EVENT_CHANNEL = 'english-ask:capture-telemetry-event'
export const TELEMETRY_EVENT_NAMES = [
  'app_opened',
  'view_changed',
  'ask_submitted',
  'ask_completed',
  'note_created'
] as const
export const DEFAULT_GEMINI_MODEL_OPTIONS = [
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash'
] as const
export const DEFAULT_MODEL_PROVIDER = 'google-gemini'
export const MODEL_PROVIDER_OPTIONS = [
  {
    id: DEFAULT_MODEL_PROVIDER,
    label: 'Google Gemini'
  },
  {
    id: 'openai',
    label: 'OpenAI'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter'
  },
  {
    id: 'anthropic',
    label: 'Anthropic / Claude'
  }
] as const
export const DYNAMIC_MODEL_LIST_PROVIDERS = ['google-gemini', 'deepseek', 'openai', 'openrouter', 'anthropic'] as const
export const DEFAULT_MODEL_OPTIONS_BY_PROVIDER = {
  'google-gemini': DEFAULT_GEMINI_MODEL_OPTIONS,
  openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  openrouter: ['openai/gpt-4.1', 'anthropic/claude-3.5-sonnet', 'deepseek/deepseek-chat'],
  anthropic: ['claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-opus-5-5']
} as const
export const DEFAULT_ANSWER_LANGUAGE = 'zh'
// Both values remain valid for historical messages; new answers use the default only.
export const DEFAULT_ANSWER_LANGUAGE_OPTIONS = [
  {
    id: 'zh',
    label: 'Chinese'
  },
  {
    id: 'en',
    label: 'English'
  }
] as const

export type ChatRole = 'user' | 'assistant'
export type DefaultAnswerLanguage = (typeof DEFAULT_ANSWER_LANGUAGE_OPTIONS)[number]['id']
export type GeminiModel = string
export type ModelProvider = (typeof MODEL_PROVIDER_OPTIONS)[number]['id']
export type NoteStorageSource = 'custom' | 'default'
export type ProviderModel = string
export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number]
export type TelemetryEventProperties = Record<
  string,
  string | number | boolean | null | undefined
>

export const isTelemetryEventName = (value: unknown): value is TelemetryEventName => {
  return (
    typeof value === 'string' &&
    (TELEMETRY_EVENT_NAMES as readonly string[]).includes(value)
  )
}

export const isTelemetryEventProperties = (
  value: unknown
): value is TelemetryEventProperties => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  return Object.values(value).every(
    (propertyValue) =>
      propertyValue === undefined ||
      propertyValue === null ||
      typeof propertyValue === 'string' ||
      typeof propertyValue === 'number' ||
      typeof propertyValue === 'boolean'
  )
}

export const supportsDynamicModelListing = (modelProvider: ModelProvider): boolean => {
  return DYNAMIC_MODEL_LIST_PROVIDERS.includes(
    modelProvider as (typeof DYNAMIC_MODEL_LIST_PROVIDERS)[number]
  )
}

export interface ChatMessage {
  answerTags?: string[]
  id: string
  role: ChatRole
  content: string
  createdAt: string
  responseDurationMs?: number
  formatWarning?: string
  warningStage?: 'format' | 'grammar'
  retryRequestId?: string
  retryQuestionMessageId?: string
  answerLanguage?: DefaultAnswerLanguage
  routerDiagnostic?: RouterDiagnostic
  knowledgeCard?: KnowledgeCard
}

export interface AskEnglishRequest {
  requestId: string
  retryOfRequestId?: string
  question: string
  history: ChatMessage[]
}

export interface CancelAskEnglishRequest {
  requestId: string
}

export interface ListProviderModelsRequest {
  modelProvider: ModelProvider
  apiKey?: string
}

export interface AskEnglishResponse {
  answerTags?: string[]
  answer: string
  formatWarning?: string
  warningStage?: 'format' | 'grammar'
  model: string
  answerLanguage?: DefaultAnswerLanguage
  routerDiagnostic?: RouterDiagnostic
  knowledgeCard?: KnowledgeCard
}

export interface ProviderSettingsState {
  savedApiKeyLength?: number
  hasApiKey: boolean
  apiKeySource: 'app' | 'environment' | 'missing'
  modelName: ProviderModel
}

export interface SettingsState {
  jevChannel?: JevChannel
  jevChannelKeyLengths?: Partial<Record<JevChannel, number>>
  jevChannelKeys?: Partial<Record<JevChannel, boolean>>
  jevCloudflareAccountId?: string
  jevRoutingEnabled?: boolean
  hasJevApiKey?: boolean
  providerSettings?: Partial<Record<ModelProvider, ProviderSettingsState>>
  modelProvider: ModelProvider
  hasApiKey: boolean
  apiKeySource: 'app' | 'environment' | 'missing'
  modelName: ProviderModel
  hasGeminiApiKey: boolean
  geminiModel: GeminiModel
  defaultAnswerLanguage: DefaultAnswerLanguage
  systemPrompt: string
  noteStorageDirectory: string
  noteStorageSource: NoteStorageSource
}

export interface SaveSettingsRequest {
  jevChannel?: JevChannel
  jevCloudflareAccountId?: string
  jevRoutingEnabled?: boolean
  jevApiKey?: string
  removeJevApiKey?: boolean
  modelProvider: ModelProvider
  apiKey?: string
  modelName: ProviderModel
  geminiApiKey?: string
  geminiModel?: GeminiModel
  defaultAnswerLanguage: DefaultAnswerLanguage
  systemPrompt: string
}

export interface SaveNoteImageRequest {
  fileName: string
  mimeType: string
  data: ArrayBuffer
}

export interface SaveNoteImageResponse {
  fileName: string
  size: number
  url: string
}

export interface PronunciationAudioRequest {
  text: string
}

export interface PronunciationAudioResponse {
  data: string
  mimeType: 'audio/mpeg'
}

export interface NoteSummary {
  tags?: string[]
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface NoteDocument extends NoteSummary {
  markdown: string
  canUndoUpdate?: boolean
}

export interface CreateNoteRequest {
  markdown: string
  name?: string
}

export type AskNoteOperation = 'create' | 'update'

export interface AskNoteTopic {
  id: string
  title: string
  messageIds: string[]
}

export interface AskNotePlan {
  topics: AskNoteTopic[]
}

export interface PlanAskNotesRequest {
  messages: ChatMessage[]
}

export interface FormatAskNoteRequest {
  operation: AskNoteOperation
  askId?: string
  messages: ChatMessage[]
  existingNote?: NoteDocument
}

export interface FormattedAskNote {
  title?: string
  markdown: string
}

export type SaveNoteRequest = {
  id: string
  markdown: string
  expectedMarkdown?: string
  expectedDirectory?: string
  preservePrevious?: boolean
} | {
  id: string
  restorePrevious: true
  expectedMarkdown: string
  expectedDirectory: string
}

export interface RenameNoteRequest {
  id: string
  name: string
}

export interface DeleteNoteResponse {
  id: string
  deleted: boolean
}

export type AskEnglishResult =
  | {
      ok: true
      data: AskEnglishResponse
    }
  | {
      ok: false
      error: string
      cancelled?: boolean
    }

export type CancelAskEnglishResult =
  | {
      ok: true
      cancelled: boolean
    }
  | {
      ok: false
      error: string
    }

export type SettingsResult =
  | {
      ok: true
      data: SettingsState
    }
  | {
      ok: false
      error: string
    }

export type ProviderModelsResult =
  | {
      ok: true
      data: string[]
    }
  | {
      ok: false
      error: string
    }

export type SaveNoteImageResult =
  | {
      ok: true
      data: SaveNoteImageResponse
    }
  | {
      ok: false
      error: string
    }

export type PronunciationAudioResult =
  | {
      ok: true
      data: PronunciationAudioResponse
    }
  | {
      ok: false
      error: string
    }

export type NotesListResult =
  | {
      ok: true
      data: NoteSummary[]
    }
  | {
      ok: false
      error: string
    }

export type NoteDocumentResult =
  | {
      ok: true
      data: NoteDocument
    }
  | {
      ok: false
      error: string
    }

export type FormatAskNoteResult =
  | {
      ok: true
      data: FormattedAskNote
    }
  | {
      ok: false
      error: string
    }

export type PlanAskNotesResult =
  | {
      ok: true
      data: AskNotePlan
    }
  | {
      ok: false
      error: string
    }

export type DeleteNoteResult =
  | {
      ok: true
      data: DeleteNoteResponse
    }
  | {
      ok: false
      error: string
    }

export type NoteStorageSettingsResult =
  | {
      ok: true
      data: {
        changed: boolean
        settings: SettingsState
      }
    }
  | {
      ok: false
      error: string
    }
