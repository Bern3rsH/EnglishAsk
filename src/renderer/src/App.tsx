import { JEV_CHANNELS, type JevChannel } from '../../shared/jev'
import { readNoteProvenance, replaceNoteBody, withoutNoteProvenance } from '../../shared/note-provenance'
import { AnkiDraftDialog } from './anki-draft-dialog'
import {
  type CSSProperties,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { FilePenLine, FilePlus2, Pause, RotateCcw, Trash2, Undo2, Volume2 } from 'lucide-react'
import { NoteUpdatePreview } from './note-update-preview'
import { UnformattedAnswer } from './unformatted-answer'
import { AppSelect } from './app-select'
import { ComposerModelMenu } from './composer-model-menu'
import { getAnswerTags } from '../../shared/answer-tags'
import { getDiagnosticLabel, InterfaceMessage } from './interface-message'
import {
  DEFAULT_ANSWER_LANGUAGE,
  DEFAULT_GEMINI_MODEL_OPTIONS,
  DEFAULT_MODEL_OPTIONS_BY_PROVIDER,
  DEFAULT_MODEL_PROVIDER,
  MODEL_PROVIDER_OPTIONS,
  supportsDynamicModelListing,
  type AskNoteTopic,
  type ChatMessage,
  type DefaultAnswerLanguage,
  type ModelProvider,
  type NoteDocument,
  type NoteSummary,
  type SettingsState
} from '../../shared/ai'
import type { KnowledgeCard } from '../../shared/knowledge-card'
import { PROMPT_DESIGN_SECTIONS } from '../../shared/prompt-design'
import type { RouterDiagnostic } from '../../shared/router'
import {
  appendMessagesToSession,
  createChatSession,
  deleteChatSession,
  filterChatSessions,
  getNextActiveChatSessionIdAfterDelete,
  normalizeChatSessions,
  renameChatSession,
  ASK_DELETE_CONFIRMATION_DETAIL,
  sortChatSessionsByRecent,
  type ChatSession
} from './chat-history'
import {
  DEFAULT_LIST_PANEL_WIDTH_PX,
  MAX_LIST_PANEL_WIDTH_PX,
  MIN_LIST_PANEL_WIDTH_PX,
  clampListPanelWidth,
  getCompletedQuestionStartScrollTop,
  getRestoredConversationScrollTop,
  getSidebarNavItemClassName,
  shouldAutoScrollConversation,
  shouldShowProviderModelNames,
  type AppWorkspace,
  type SettingsSection
} from './layout'
import { MarkdownContent } from './markdown'
import { shouldSubmitComposerOnKeyDown } from './composer-keyboard'
import { isNewItemShortcut } from './app-shortcuts'
import { captureTelemetryEvent } from './telemetry'
import {
  isCurrentAskRequest,
  getRetryQuestion,
  persistAskRequests,
  restoreAskRequests,
  reduceAskRequestState,
  type AskRequestAction,
  type AskRequestsState
} from './ask-request-state'
import {
  LiveMarkdownEditor,
  type LiveMarkdownEditorHandle
} from './live-markdown-editor'
import {
  filterNotes,
  getGeneratedNoteTitle,
  replaceRenamedNoteSummary,
  sortNotesByFileName,
  upsertNoteSummary
} from './notes'
import { createNotesSynchronizer, NOTES_SYNC_INTERVAL_MS } from './notes-sync'
import {
  getAskNoteOriginalMarkdown,
  getAskNoteQuestion,
  getMessagesForAskNoteTopics,
  getSelectedAskNoteTopics,
  updateAskNoteTopicSelection
} from './ask-note-topics'
import {
  formatKnowledgeCardAsMarkdown,
  inferKnowledgeCardAnswerLanguage
} from './knowledge-card-format'
import {
  createPronunciationAudioDataUrl,
  getMessagePronunciationTargets,
  getPronunciationPlaybackKey,
  PRONUNCIATION_LANGUAGE,
  PRONUNCIATION_RATE,
  selectEnglishPronunciationVoice
} from './pronunciation'

const MISSING_BRIDGE_ERROR = '无法连接桌面服务，请重启应用。'
const SETTINGS_SAVED_MESSAGE = '设置已保存。'
const SETTINGS_SAVED_MESSAGE_DURATION_MS = 3000
const SETTINGS_MISSING_BRIDGE_ERROR = '请在桌面应用中使用设置。'
const CHAT_HISTORY_STORAGE_KEY = 'english-ask:chat-history'
const CONTEXT_MENU_VIEWPORT_MARGIN = 12
const HISTORY_CONTEXT_MENU_WIDTH = 172
const HISTORY_CONTEXT_MENU_HEIGHT = 92
const SAVED_API_KEY_MASK_VALUE = 'saved-gemini-api-key'
const savedApiKeyMask = (length?: number): string =>
  length === undefined ? SAVED_API_KEY_MASK_VALUE : '*'.repeat(length)
const NOTE_AUTOSAVE_DELAY_MS = 400
const ASKS_LIST_WIDTH_STORAGE_KEY = 'english-ask:asks-list-width'
const NOTES_LIST_WIDTH_STORAGE_KEY = 'english-ask:notes-list-width'
const LIST_PANEL_KEYBOARD_RESIZE_STEP_PX = 16

const NewAskIcon = (): ReactElement => (
  <svg aria-hidden="true" className="composeGlyph" focusable="false" viewBox="0 0 24 24">
    <path
      clipRule="evenodd"
      d="M12 3C7.85113 3 4 5.73396 4 10C4 11.5704 4.38842 12.7289 5.08252 13.6554C5.79003 14.5998 6.87746 15.3863 8.41627 16.0908L9.2326 16.4645L8.94868 17.3162C8.54129 18.5384 7.84997 19.6611 7.15156 20.5844C9.56467 19.8263 12.7167 18.6537 14.9453 17.1679C17.1551 15.6948 18.3969 14.5353 19.0991 13.455C19.7758 12.4139 20 11.371 20 10C20 5.73396 16.1489 3 12 3ZM2 10C2 4.26604 7.14887 1 12 1C16.8511 1 22 4.26604 22 10C22 11.629 21.7242 13.0861 20.7759 14.545C19.8531 15.9647 18.3449 17.3052 16.0547 18.8321C13.0781 20.8164 8.76589 22.2232 6.29772 22.9281C5.48665 23.1597 4.84055 22.6838 4.56243 22.1881C4.28848 21.6998 4.22087 20.9454 4.74413 20.3614C5.44439 19.5798 6.21203 18.5732 6.72616 17.4871C5.40034 16.7841 4.29326 15.9376 3.48189 14.8545C2.48785 13.5277 2 11.9296 2 10Z"
      fill="currentColor"
      fillRule="evenodd"
    />
    <path
      d="M12 6C11.4477 6 11 6.44771 11 7V9H9C8.44772 9 8 9.44771 8 10C8 10.5523 8.44772 11 9 11H11V13C11 13.5523 11.4477 14 12 14C12.5523 14 13 13.5523 13 13V11H15C15.5523 11 16 10.5523 16 10C16 9.44772 15.5523 9 15 9H13V7C13 6.44771 12.5523 6 12 6Z"
      fill="currentColor"
    />
  </svg>
)

const SearchIcon = (): ReactElement => (
  <svg aria-hidden="true" className="searchGlyph" focusable="false" viewBox="0 0 24 24">
    <path
      d="M11 6C13.7614 6 16 8.23858 16 11M16.6588 16.6549L21 21M19 11C19 15.4183 15.4183 19 11 19C6.58172 19 3 15.4183 3 11C3 6.58172 6.58172 3 11 3C15.4183 3 19 6.58172 19 11Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  </svg>
)

const PlusLargeIcon = (): ReactElement => (
  <svg aria-hidden="true" className="plusLargeGlyph" focusable="false" viewBox="0 0 24 24">
    <path
      d="M4 12H20M12 4V20"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  </svg>
)

const NotesIcon = (): ReactElement => (
  <svg aria-hidden="true" className="notesGlyph" focusable="false" viewBox="0 0 24 24">
    <path
      d="M7 4H17C18.1046 4 19 4.89543 19 6V20L15.5 18L12 20L8.5 18L5 20V6C5 4.89543 5.89543 4 7 4Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
    <path
      d="M9 8H15M9 12H15"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
    />
  </svg>
)

const SettingsIcon = (): ReactElement => (
  <svg aria-hidden="true" className="settingsGlyph" focusable="false" viewBox="0 0 35 35">
    <path
      d="M24.5,32.849h-14a3.236,3.236,0,0,1-2.792-1.613l-7-12.124a3.231,3.231,0,0,1,0-3.223l7-12.125A3.234,3.234,0,0,1,10.5,2.151h14a3.234,3.234,0,0,1,2.793,1.612l7,12.125a3.231,3.231,0,0,1,0,3.223l-7,12.125A3.235,3.235,0,0,1,24.5,32.849Zm-14-28.2a.727.727,0,0,0-.627.363l-7,12.124a.725.725,0,0,0,0,.725l7,12.123a.727.727,0,0,0,.627.363h14a.726.726,0,0,0,.629-.364l7-12.123a.725.725,0,0,0,0-.725l-7-12.123a.725.725,0,0,0-.628-.363Z"
      fill="currentColor"
    />
    <path
      d="M17.5,23.862A6.362,6.362,0,1,1,23.862,17.5,6.369,6.369,0,0,1,17.5,23.862Zm0-10.224A3.862,3.862,0,1,0,21.362,17.5,3.866,3.866,0,0,0,17.5,13.638Z"
      fill="currentColor"
    />
  </svg>
)

const RefreshModelsIcon = (): ReactElement => (
  <svg aria-hidden="true" className="refreshModelsGlyph" focusable="false" viewBox="0 0 24 24">
    <path
      d="M4.06189 13C4.02104 12.6724 4 12.3387 4 12C4 7.58172 7.58172 4 12 4C14.5006 4 16.7332 5.14727 18.2002 6.94416M19.9381 11C19.979 11.3276 20 11.6613 20 12C20 16.4183 16.4183 20 12 20C9.61061 20 7.46589 18.9525 6 17.2916M9 17H6V17.2916M18.2002 4V6.94416M18.2002 6.94416V6.99993L15.2002 7M6 20V17.2916"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  </svg>
)

const BackIcon = (): ReactElement => (
  <svg aria-hidden="true" className="backGlyph" focusable="false" viewBox="0 0 24 24">
    <path
      d="M15 5L8 12l7 7"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.4"
    />
  </svg>
)

const SendIcon = (): ReactElement => (
  <svg aria-hidden="true" className="sendGlyph" focusable="false" viewBox="0 0 38 38">
    <circle cx="19" cy="19" fill="#ececec" r="19" />
    <path
      d="M19 26V11M12.5 17.5L19 11l6.5 6.5"
      fill="none"
      stroke="#171717"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="3.5"
    />
  </svg>
)

const StopIcon = (): ReactElement => (
  <svg aria-hidden="true" className="stopGlyph" focusable="false" viewBox="0 0 38 38">
    <circle cx="19" cy="19" fill="#ececec" r="19" />
    <rect fill="#171717" height="12" rx="2" width="12" x="13" y="13" />
  </svg>
)

interface HistoryContextMenuState {
  sessionId: string
  x: number
  y: number
}

interface NoteContextMenuState {
  noteId: string
  x: number
  y: number
}

interface ConfirmationDialogState {
  title: string
  detail: string
  confirmLabel: string
  onConfirm: () => void | Promise<void>
}

const RouterDiagnosticContent = ({
  diagnostic,
  cardType,
  responseDurationMs
}: {
  diagnostic: RouterDiagnostic
  cardType?: KnowledgeCard['cardType']
  responseDurationMs?: number
}): ReactElement => {
  const routing = diagnostic.routing
  const jevStatus = !routing ? '未记录'
    : routing.source === 'jev-assisted' ? '是（已采用分类结果）'
      : routing.source === 'jev-fallback' ? '已尝试，未采用（回退原分类器）'
        : routing.source === 'rule' ? '否（本地规则）' : '否（原分类器）'
  const jevRow = (
    <div>
      <dt>使用 Jev</dt>
      <dd>{jevStatus}{routing?.channel ? ` · ${JEV_CHANNELS[routing.channel].label}` : ''}</dd>
    </div>
  )
  const durationRow = (
    <div>
      <dt>总耗时</dt>
      <dd>{responseDurationMs === undefined ? '未记录' : `${(responseDurationMs / 1000).toFixed(2)} 秒`}</dd>
    </div>
  )
  if (diagnostic.status === 'error') {
    return (
      <aside aria-label="分类诊断" className="routerDiagnostic routerDiagnostic-error">
        <div className="routerDiagnosticHeader">
          <strong>分类器</strong>
          <code>分类失败</code>
        </div>
        <div><InterfaceMessage message={diagnostic.message} /></div>
        <dl className="routerDiagnosticDetails">{jevRow}{durationRow}</dl>
      </aside>
    )
  }

  const { classification } = diagnostic

  return (
    <aside aria-label="分类诊断" className="routerDiagnostic">
      <div className="routerDiagnosticHeader">
        <strong>分类器</strong>
        <code>{getDiagnosticLabel(classification.inputType)}</code>
      </div>
      <dl className="routerDiagnosticDetails">
        {jevRow}
        <div>
          <dt>输入类型</dt>
          <dd>{getDiagnosticLabel(classification.inputType)}</dd>
        </div>
        <div>
          <dt>结构</dt>
          <dd>{getDiagnosticLabel(classification.structureType)}</dd>
        </div>
        <div>
          <dt>卡片类型</dt>
          <dd>{cardType ? getDiagnosticLabel(cardType) : '无'}</dd>
        </div>
        <div>
          <dt>目标</dt>
          <dd>{classification.targetText || '无'}</dd>
        </div>
        <div>
          <dt>目标列表</dt>
          <dd>{classification.targets.join(', ') || '无'}</dd>
        </div>
        <div>
          <dt>意图</dt>
          <dd>{getDiagnosticLabel(classification.intent)}</dd>
        </div>
        <div>
          <dt>响应方式</dt>
          <dd>{getDiagnosticLabel(classification.responseMode)}</dd>
        </div>
        <div>
          <dt>内容模块</dt>
          <dd>{classification.modules.map(getDiagnosticLabel).join('、') || '无'}</dd>
        </div>
        <div>
          <dt>置信度</dt>
          <dd>{Math.round(classification.confidence * 100)}%</dd>
        </div>
        {durationRow}
      </dl>
    </aside>
  )
}

const getMessageMarkdownContent = (message: ChatMessage): string =>
  message.knowledgeCard
    ? formatKnowledgeCardAsMarkdown(
        message.knowledgeCard,
        message.answerLanguage ?? inferKnowledgeCardAnswerLanguage(message.knowledgeCard),
        message.routerDiagnostic?.status === 'success'
          ? message.routerDiagnostic.classification.intent
          : undefined
      )
    : message.content

const createMessage = (
  role: ChatMessage['role'],
  content: string,
  routerDiagnostic?: RouterDiagnostic,
  knowledgeCard?: KnowledgeCard,
  answerLanguage?: DefaultAnswerLanguage
): ChatMessage => {
  const messageId =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

  return {
    id: messageId,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...(answerLanguage ? { answerLanguage } : {}),
    ...(routerDiagnostic ? { routerDiagnostic } : {}),
    ...(knowledgeCard ? { knowledgeCard } : {})
  }
}

const loadInitialChatSessions = (): ChatSession[] => {
  if (typeof localStorage === 'undefined') {
    return [createChatSession()]
  }

  try {
    const storedHistory = localStorage.getItem(CHAT_HISTORY_STORAGE_KEY)

    if (!storedHistory) {
      return [createChatSession()]
    }

    const restoredSessions = normalizeChatSessions(JSON.parse(storedHistory))

    return restoredSessions.length > 0 ? restoredSessions : [createChatSession()]
  } catch (error) {
    console.warn('Unable to restore chat history', error)
    return [createChatSession()]
  }
}

const getSettingsLabel = (
  settings: SettingsState | null,
  selectedModelProvider: ModelProvider
): string => {
  if (!settings) {
    return '正在检查密钥'
  }

  const providerSettings = settings.providerSettings?.[selectedModelProvider] ??
    (settings.modelProvider === selectedModelProvider ? settings : undefined)

  if (providerSettings?.apiKeySource === 'app') {
    return '密钥已保存'
  }

  if (providerSettings?.apiKeySource === 'environment') {
    return '使用环境变量密钥'
  }

  return '需要密钥'
}

const loadInitialListPanelWidth = (
  storageKey: string,
  panelLabel: 'Asks' | 'Notes'
): number => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return DEFAULT_LIST_PANEL_WIDTH_PX
  }

  try {
    const storedValue = localStorage.getItem(storageKey)
    const storedWidth =
      storedValue === null ? DEFAULT_LIST_PANEL_WIDTH_PX : Number(storedValue)
    return clampListPanelWidth(storedWidth, window.innerWidth)
  } catch (error) {
    console.warn(`Unable to restore ${panelLabel} list width`, error)
    return clampListPanelWidth(DEFAULT_LIST_PANEL_WIDTH_PX, window.innerWidth)
  }
}

export const App = (): ReactElement => {
  const [activeView, setActiveView] = useState<'chat' | 'settings'>('chat')
  const [activeWorkspace, setActiveWorkspace] = useState<AppWorkspace>('asks')
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>('models')
  const [initialChatSessions] = useState<ChatSession[]>(() => loadInitialChatSessions())
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(initialChatSessions)
  const [activeSessionId, setActiveSessionId] = useState(initialChatSessions[0]?.id ?? null)
  const [question, setQuestion] = useState('')
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [recoverableNote, setRecoverableNote] = useState<NoteDocument | null>(null)
  const [ankiSource, setAnkiSource] = useState<{ note: NoteDocument; directory: string } | null>(null)
  const [isOpeningAnki, setIsOpeningAnki] = useState(false)
  const openingAnkiRef = useRef(false)
  const [noteUpdatePreview, setNoteUpdatePreview] = useState<{
    original: NoteDocument
    markdown: string
    directory: string
  } | null>(null)
  const [noteUpdateError, setNoteUpdateError] = useState<string | null>(null)
  const [isSavingNoteUpdate, setIsSavingNoteUpdate] = useState(false)
  const noteUpdateInFlightRef = useRef(false)
  const [historySearch, setHistorySearch] = useState('')
  const [notesSearch, setNotesSearch] = useState('')
  const [isAskSearchVisible, setIsAskSearchVisible] = useState(false)
  const [isNotesSearchVisible, setIsNotesSearchVisible] = useState(false)
  const [historyContextMenu, setHistoryContextMenu] = useState<HistoryContextMenuState | null>(null)
  const [noteContextMenu, setNoteContextMenu] = useState<NoteContextMenuState | null>(null)
  const [confirmationDialog, setConfirmationDialog] = useState<ConfirmationDialogState | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null)
  const [noteRenameSurface, setNoteRenameSurface] = useState<'list' | 'title' | null>(null)
  const [noteRenameDraft, setNoteRenameDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [noteImageError, setNoteImageError] = useState<string | null>(null)
  const [noteSyncError, setNoteSyncError] = useState<string | null>(null)
  const [askRequests, setAskRequests] = useState<AskRequestsState>(() => restoreAskRequests(initialChatSessions))
  const [speakingPronunciationId, setSpeakingPronunciationId] = useState<string | null>(null)
  const [askNoteOperation, setAskNoteOperation] = useState<
    'plan' | 'create' | 'update' | null
  >(null)
  const [askNoteTopics, setAskNoteTopics] = useState<AskNoteTopic[]>([])
  const [selectedAskNoteTopicIds, setSelectedAskNoteTopicIds] = useState<string[]>([])
  const [isSelectingAskNoteTopics, setIsSelectingAskNoteTopics] = useState(false)
  const [isSelectingNoteToUpdate, setIsSelectingNoteToUpdate] = useState(false)
  const [selectedNoteToUpdateId, setSelectedNoteToUpdateId] = useState('')
  const [modelName, setModelName] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [selectedModelProvider, setSelectedModelProvider] =
    useState<ModelProvider>(DEFAULT_MODEL_PROVIDER)
  const [providerApiKey, setProviderApiKey] = useState('')
  const [jevRoutingEnabled, setJevRoutingEnabled] = useState<boolean | undefined>(undefined)
  const [jevChannelDraft, setJevChannelDraft] = useState<JevChannel | undefined>(undefined)
  const [isEditingJevApiKey, setIsEditingJevApiKey] = useState(false)
  const [jevKeyDrafts, setJevKeyDrafts] = useState<Partial<Record<JevChannel, string>>>({})
  const [jevAccountIdDraft, setJevAccountIdDraft] = useState<string | undefined>(undefined)
  const jevChannel = jevChannelDraft ?? settings?.jevChannel ?? 'openrouter'
  const jevChannelInfo = JEV_CHANNELS[jevChannel]
  const jevApiKey = jevKeyDrafts[jevChannel] ?? ''
  const setJevApiKey = (value: string): void => setJevKeyDrafts(current => ({ ...current, [jevChannel]: value }))
  const hasSelectedJevKey = settings?.jevChannelKeys?.[jevChannel] ??
    (jevChannel === 'openrouter' && !settings?.jevChannelKeys ? settings?.hasJevApiKey : false)
  const jevApiKeyInputValue = !isEditingJevApiKey && !jevApiKey && hasSelectedJevKey
    ? savedApiKeyMask(settings?.jevChannelKeyLengths?.[jevChannel]) : jevApiKey
  const jevAccountId = jevAccountIdDraft ?? settings?.jevCloudflareAccountId ?? '' 
  const [isEditingGeminiApiKey, setIsEditingGeminiApiKey] = useState(false)
  const [availableModelOptions, setAvailableModelOptions] = useState<string[]>([
    ...DEFAULT_GEMINI_MODEL_OPTIONS
  ])
  const [selectedModelName, setSelectedModelName] = useState('gemini-3.5-flash')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  useEffect(() => {
    if (settingsMessage !== SETTINGS_SAVED_MESSAGE || isSavingSettings) return
    const timeout = setTimeout(() => {
      setSettingsMessage(current => current === SETTINGS_SAVED_MESSAGE ? null : current)
    }, SETTINGS_SAVED_MESSAGE_DURATION_MS)
    return () => clearTimeout(timeout)
  }, [settingsMessage, isSavingSettings])

  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [isLoadingNotes, setIsLoadingNotes] = useState(false)
  const [isUpdatingNoteStorage, setIsUpdatingNoteStorage] = useState(false)
  const [noteStorageRevision, setNoteStorageRevision] = useState(0)
  const [asksListWidth, setAsksListWidth] = useState(() =>
    loadInitialListPanelWidth(ASKS_LIST_WIDTH_STORAGE_KEY, 'Asks')
  )
  const [notesListWidth, setNotesListWidth] = useState(() =>
    loadInitialListPanelWidth(NOTES_LIST_WIDTH_STORAGE_KEY, 'Notes')
  )
  const [resizingListPanel, setResizingListPanel] = useState<AppWorkspace | null>(null)
  const conversationRef = useRef<HTMLDivElement | null>(null)
  const activeSessionIdRef = useRef<string | null>(activeSessionId)
  const askRequestsRef = useRef(askRequests)
  const chatSessionsRef = useRef(chatSessions)
  const pronunciationAudioRef = useRef<HTMLAudioElement | null>(null)
  const pronunciationUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const pronunciationPlaybackIdRef = useRef(0)
  const conversationScrollPositionsRef = useRef<Map<string, number>>(new Map())
  const messageElementRefs = useRef<Map<string, HTMLElement>>(new Map())
  const pendingCompletedAnswerRef = useRef<{
    messageId: string
    questionMessageId: string
    sessionId: string
  } | null>(null)
  const pendingConversationScrollSessionIdRef = useRef<string | null>(activeSessionId)
  const didRestoreConversationScrollRef = useRef(false)
  const questionInputRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingFocusedAskInputSessionIdRef = useRef<string | null>(null)
  const shouldFollowConversationScrollRef = useRef(true)
  const activeNoteIdRef = useRef<string | null>(null)
  const noteDraftRef = useRef('')
  const isNoteDirtyRef = useRef(false)
  const notesSyncReadyRef = useRef(false)
  const notesSyncRevisionRef = useRef(0)
  const noteSavesInFlightRef = useRef(0)
  const notesSyncContextRef = useRef({ notes, isBusy: false })
  const noteSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noteEditorRef = useRef<LiveMarkdownEditorHandle | null>(null)
  const noteTitleInputRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingFocusedNoteInputIdRef = useRef<string | null>(null)
  const isNoteRenameInFlightRef = useRef(false)
  const skipNextNoteRenameBlurRef = useRef(false)
  const listPanelResizeStartRef = useRef({
    pointerX: 0,
    width: DEFAULT_LIST_PANEL_WIDTH_PX
  })
  const englishAskBridge = window.englishAsk
  notesSyncContextRef.current = {
    notes,
    isBusy:
      isLoadingNotes || isUpdatingNoteStorage || askNoteOperation !== null || renamingNoteId !== null || isOpeningAnki || ankiSource !== null
  }
  const activeSession =
    chatSessions.find((session) => session.id === activeSessionId) ?? chatSessions[0] ?? null
  const messages = activeSession?.messages ?? []
  const activeAskRequest = activeSession ? askRequests.get(activeSession.id) : undefined
  const isSending = activeAskRequest?.status === 'pending'
  const visibleError = error ?? activeAskRequest?.error
  const visibleNoteError = noteImageError ?? noteSyncError
  const sortedChatSessions = useMemo(
    () => filterChatSessions(sortChatSessionsByRecent(chatSessions), historySearch),
    [chatSessions, historySearch]
  )
  const visibleNotes = useMemo(
    () => filterNotes(sortNotesByFileName(notes), notesSearch),
    [notes, notesSearch]
  )
  const activeNote =
    activeNoteId === null
      ? null
      : notes.find((note) => note.id === activeNoteId) ?? null
  const isEditingActiveNoteTitle =
    activeNote !== null &&
    renamingNoteId === activeNote.id &&
    noteRenameSurface === 'title'
  const activeNoteTitleValue = isEditingActiveNoteTitle
    ? noteRenameDraft
    : activeNote?.title ?? 'Notes'
  const historyContextMenuSession = historyContextMenu
    ? chatSessions.find((session) => session.id === historyContextMenu.sessionId) ?? null
    : null
  const selectedProviderLabel =
    MODEL_PROVIDER_OPTIONS.find((providerOption) => providerOption.id === selectedModelProvider)
      ?.label ?? '服务商'
  const selectedProviderSettings = settings?.providerSettings?.[selectedModelProvider] ??
    (settings?.modelProvider === selectedModelProvider ? settings : undefined)
  const hasTypedProviderApiKey = providerApiKey.trim().length > 0
  const shouldShowModelNames = shouldShowProviderModelNames(
    hasTypedProviderApiKey,
    selectedProviderSettings?.hasApiKey === true,
    selectedProviderSettings !== undefined
  )
  const canRefreshSelectedProviderModels =
    supportsDynamicModelListing(selectedModelProvider)
  const isSelectedModelAvailable = availableModelOptions.includes(selectedModelName)
  const visibleModelOptions = shouldShowModelNames ? availableModelOptions : []
  const visibleSelectedModelName = shouldShowModelNames ? selectedModelName : ''
  const visibleComposerModelName =
    settings?.modelName ?? modelName
  const canUseSpeechSynthesis =
    typeof window !== 'undefined' &&
    typeof window.speechSynthesis !== 'undefined' &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  const canPlayPronunciation =
    typeof Audio !== 'undefined' &&
    (typeof englishAskBridge?.getPronunciationAudio === 'function' || canUseSpeechSynthesis)
  const shouldShowSavedApiKeyMask =
    !isEditingGeminiApiKey &&
    providerApiKey.length === 0 &&
    selectedProviderSettings?.apiKeySource === 'app'
  const providerApiKeyInputValue = shouldShowSavedApiKeyMask
    ? savedApiKeyMask(settings?.providerSettings?.[selectedModelProvider]?.savedApiKeyLength)
    : providerApiKey
  const visibleSettingsSection = activeSettingsSection
  const telemetryView =
    activeView === 'settings' ? `settings:${visibleSettingsSection}` : activeWorkspace

  useEffect(() => {
    captureTelemetryEvent('view_changed', { view: telemetryView })
  }, [telemetryView])

  const uploadNoteImage = useCallback(
    async (image: File): Promise<string> => {
      if (!englishAskBridge?.saveNoteImage) {
        const message = '请在桌面应用中插入图片。'
        setNoteImageError(message)
        throw new Error(message)
      }

      try {
        const result = await englishAskBridge.saveNoteImage({
          fileName: image.name,
          mimeType: image.type,
          data: await image.arrayBuffer()
        })

        if (!result.ok) {
          throw new Error(result.error)
        }

        setNoteImageError(null)
        return result.data.url
      } catch (error) {
        const message = error instanceof Error ? error.message : '无法插入图片。'

        setNoteImageError(message)
        throw error
      }
    },
    [englishAskBridge]
  )
  const saveActiveConversationScrollPosition = (): void => {
    const conversation = conversationRef.current

    if (!activeSessionId || !conversation) {
      return
    }

    conversationScrollPositionsRef.current.set(activeSessionId, conversation.scrollTop)
  }

  const updateAskRequest = (action: AskRequestAction): boolean => {
    const nextState = reduceAskRequestState(askRequestsRef.current, action)

    if (nextState === askRequestsRef.current) {
      return false
    }

    // Update synchronously so repeated submissions cannot race React's next render.
    askRequestsRef.current = nextState
    setAskRequests(nextState)
    return true
  }

  const stopPronunciation = useCallback((): void => {
    pronunciationPlaybackIdRef.current += 1

    const currentAudio = pronunciationAudioRef.current

    if (currentAudio) {
      currentAudio.onended = null
      currentAudio.onerror = null
      currentAudio.pause()

      try {
        currentAudio.currentTime = 0
      } catch {
        // Some media backends reject seeking before metadata has loaded.
      }

      pronunciationAudioRef.current = null
    }

    const currentUtterance = pronunciationUtteranceRef.current

    if (currentUtterance) {
      currentUtterance.onend = null
      currentUtterance.onerror = null
      pronunciationUtteranceRef.current = null
    }

    if (canUseSpeechSynthesis) {
      window.speechSynthesis.cancel()
    }

    setSpeakingPronunciationId(null)
  }, [canUseSpeechSynthesis])

  const togglePronunciation = useCallback(
    async (message: ChatMessage, targetText: string): Promise<void> => {
      if (!canPlayPronunciation || !getMessagePronunciationTargets(message).includes(targetText)) {
        return
      }

      const targetPlaybackKey = getPronunciationPlaybackKey(message.id, targetText)
      if (speakingPronunciationId === targetPlaybackKey) {
        stopPronunciation()
        return
      }

      stopPronunciation()
      const playbackId = pronunciationPlaybackIdRef.current
      let didStartSystemFallback = false
      setSpeakingPronunciationId(targetPlaybackKey)

      const finishPronunciation = (): void => {
        if (pronunciationPlaybackIdRef.current !== playbackId) {
          return
        }

        const currentAudio = pronunciationAudioRef.current

        if (currentAudio) {
          currentAudio.onended = null
          currentAudio.onerror = null
          pronunciationAudioRef.current = null
        }

        const currentUtterance = pronunciationUtteranceRef.current

        if (currentUtterance) {
          currentUtterance.onend = null
          currentUtterance.onerror = null
          pronunciationUtteranceRef.current = null
        }

        setSpeakingPronunciationId((currentPlaybackKey) =>
          currentPlaybackKey === targetPlaybackKey ? null : currentPlaybackKey
        )
      }

      const playSystemFallback = (edgeError?: unknown): void => {
        if (
          didStartSystemFallback ||
          pronunciationPlaybackIdRef.current !== playbackId
        ) {
          return
        }

        didStartSystemFallback = true

        if (edgeError) {
          console.warn('Neural pronunciation unavailable; using system voice', edgeError)
        }

        const currentAudio = pronunciationAudioRef.current

        if (currentAudio) {
          currentAudio.onended = null
          currentAudio.onerror = null
          currentAudio.pause()
          pronunciationAudioRef.current = null
        }

        if (!canUseSpeechSynthesis) {
          finishPronunciation()
          return
        }

        try {
          const utterance = new SpeechSynthesisUtterance(targetText)
          const selectedVoice = selectEnglishPronunciationVoice(
            window.speechSynthesis.getVoices()
          )

          utterance.lang = PRONUNCIATION_LANGUAGE
          utterance.rate = PRONUNCIATION_RATE

          if (selectedVoice) {
            utterance.voice = selectedVoice
          }

          utterance.onend = finishPronunciation
          utterance.onerror = finishPronunciation
          pronunciationUtteranceRef.current = utterance
          window.speechSynthesis.speak(utterance)
        } catch (error) {
          console.warn('Unable to play system pronunciation', error)
          finishPronunciation()
        }
      }

      if (!englishAskBridge?.getPronunciationAudio) {
        playSystemFallback()
        return
      }

      try {
        const result = await englishAskBridge.getPronunciationAudio({ text: targetText })

        if (pronunciationPlaybackIdRef.current !== playbackId) {
          return
        }

        if (!result.ok) {
          playSystemFallback(new Error(result.error))
          return
        }

        const audio = new Audio(createPronunciationAudioDataUrl(result.data))
        audio.preload = 'auto'
        audio.onended = finishPronunciation
        audio.onerror = () => {
          playSystemFallback(new Error('无法解码发音音频。'))
        }
        pronunciationAudioRef.current = audio

        await audio.play()
      } catch (error) {
        playSystemFallback(error)
      }
    },
    [
      canPlayPronunciation,
      canUseSpeechSynthesis,
      englishAskBridge,
      speakingPronunciationId,
      stopPronunciation
    ]
  )

  const updateActiveNote = (note: NoteDocument): void => {
    notesSyncRevisionRef.current += 1
    activeNoteIdRef.current = note.id
    noteDraftRef.current = note.markdown
    isNoteDirtyRef.current = false
    setActiveNoteId(note.id)
    setNoteDraft(note.markdown)
    setRecoverableNote(note.canUndoUpdate ? note : null)
    setNoteSyncError(null)
    setNotes((currentNotes) => upsertNoteSummary(currentNotes, note))
  }

  const persistNote = useCallback(
    async (noteId: string, markdown: string): Promise<boolean> => {
      if (!englishAskBridge?.saveNote) {
        setNoteImageError('请在桌面应用中管理 Notes 存储。')
        return false
      }

      noteSavesInFlightRef.current += 1
      notesSyncRevisionRef.current += 1

      try {
        const result = await englishAskBridge.saveNote({ id: noteId, markdown })

        if (!result.ok) {
          throw new Error(result.error)
        }

        setNotes((currentNotes) => upsertNoteSummary(currentNotes, result.data))
        setNoteImageError(null)

        if (activeNoteIdRef.current === noteId && noteDraftRef.current === markdown) {
          isNoteDirtyRef.current = false
          noteDraftRef.current = result.data.markdown
          setNoteDraft(result.data.markdown)
          setRecoverableNote(result.data.canUndoUpdate ? result.data : null)
        }

        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : '无法保存 Note。'

        setNoteImageError(message)
        return false
      } finally {
        noteSavesInFlightRef.current -= 1
        notesSyncRevisionRef.current += 1
      }
    },
    [englishAskBridge]
  )

  const flushPendingNoteSave = useCallback(async (): Promise<boolean> => {
    if (noteSaveTimeoutRef.current) {
      clearTimeout(noteSaveTimeoutRef.current)
      noteSaveTimeoutRef.current = null
    }

    const noteId = activeNoteIdRef.current

    if (!noteId || !isNoteDirtyRef.current) {
      return true
    }

    return persistNote(noteId, noteDraftRef.current)
  }, [persistNote])

  const openAnkiDrafts = async (): Promise<void> => {
    const noteId = activeNoteIdRef.current
    const directory = settings?.noteStorageDirectory
    if (openingAnkiRef.current || !noteId || !directory || !englishAskBridge) return
    openingAnkiRef.current = true
    setIsOpeningAnki(true)
    setNoteImageError(null)
    try {
      if (!(await flushPendingNoteSave())) throw new Error('请先保存当前 Note，再生成卡片。')
      const result = await englishAskBridge.getNote(noteId)
      if (!result.ok) throw new Error(result.error)
      let note = result.data
      if (!readNoteProvenance(note.markdown)) {
        const saved = await englishAskBridge.saveNote({ id: noteId, markdown: note.markdown,
          expectedMarkdown: note.markdown, expectedDirectory: directory })
        if (!saved.ok) throw new Error(saved.error)
        note = saved.data
      }
      if (activeNoteIdRef.current !== noteId) return
      updateActiveNote(note)
      setAnkiSource({ note, directory })
    } catch (failure) {
      setNoteImageError(failure instanceof Error ? failure.message : '无法打开 Anki 卡片。')
    } finally {
      openingAnkiRef.current = false
      setIsOpeningAnki(false)
    }
  }

  const loadProviderModels = async (): Promise<void> => {
    if (!englishAskBridge) {
      setSettingsMessage(SETTINGS_MISSING_BRIDGE_ERROR)
      return
    }

    if (!supportsDynamicModelListing(selectedModelProvider)) {
      return
    }

    setIsLoadingModels(true)

    try {
      const apiKey = providerApiKey.trim()
      const result = await englishAskBridge.listProviderModels({
        modelProvider: selectedModelProvider,
        ...(apiKey ? { apiKey } : {})
      })

      if (result.ok) {
        setAvailableModelOptions([...new Set(result.data)])
        setSettingsMessage(
          result.data.includes(selectedModelName)
            ? null
            : `${selectedModelName} 已不可用，请选择其他模型。`
        )
      } else {
        setSettingsMessage(result.error)
      }
    } catch {
      setSettingsMessage('无法连接桌面服务。')
    } finally {
      setIsLoadingModels(false)
    }
  }

  useEffect(() => {
    let isMounted = true

    const loadSettings = async (): Promise<void> => {
      if (!englishAskBridge) {
        setSettingsMessage(SETTINGS_MISSING_BRIDGE_ERROR)
        return
      }

      const result = await englishAskBridge.getSettings()

      if (!isMounted) {
        return
      }

      if (result.ok) {
        setSettings(result.data)
        setSelectedModelProvider(result.data.modelProvider)
        setSelectedModelName(result.data.modelName)
        setSystemPrompt(result.data.systemPrompt)
        setAvailableModelOptions((currentModels) =>
          currentModels.includes(result.data.modelName)
            ? currentModels
            : [...new Set([result.data.modelName, ...DEFAULT_MODEL_OPTIONS_BY_PROVIDER[result.data.modelProvider]])]
        )
      } else {
        setSettingsMessage(result.error)
      }
    }

    void loadSettings()

    return () => {
      isMounted = false
    }
  }, [englishAskBridge])

  useEffect(() => {
    stopPronunciation()

    return () => {
      pronunciationPlaybackIdRef.current += 1

      const currentAudio = pronunciationAudioRef.current

      if (currentAudio) {
        currentAudio.onended = null
        currentAudio.onerror = null
        currentAudio.pause()
        pronunciationAudioRef.current = null
      }

      const currentUtterance = pronunciationUtteranceRef.current

      if (currentUtterance) {
        currentUtterance.onend = null
        currentUtterance.onerror = null
        pronunciationUtteranceRef.current = null
      }

      if (canUseSpeechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [activeSessionId, activeWorkspace, canUseSpeechSynthesis, stopPronunciation])

  useEffect(() => {
    let isMounted = true

    const loadNotes = async (): Promise<void> => {
      notesSyncReadyRef.current = false
      notesSyncRevisionRef.current += 1
      setNoteSyncError(null)

      if (!englishAskBridge?.listNotes || !englishAskBridge.getNote) {
        setNoteImageError('请在桌面应用中管理 Notes 存储。')
        return
      }

      setIsLoadingNotes(true)

      try {
        const notesResult = await englishAskBridge.listNotes()

        if (!isMounted) {
          return
        }

        if (!notesResult.ok) {
          throw new Error(notesResult.error)
        }

        const sortedNotes = sortNotesByFileName(notesResult.data)
        setNotes(sortedNotes)

        if (sortedNotes.length === 0) {
          activeNoteIdRef.current = null
          noteDraftRef.current = ''
          isNoteDirtyRef.current = false
          setActiveNoteId(null)
          setNoteDraft('')
          return
        }

        const noteResult = await englishAskBridge.getNote(sortedNotes[0].id)

        if (!isMounted) {
          return
        }

        if (!noteResult.ok) {
          throw new Error(noteResult.error)
        }

        updateActiveNote(noteResult.data)
        setNoteImageError(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : '无法加载 Notes。'
        setNoteImageError(message)
      } finally {
        if (isMounted) {
          notesSyncReadyRef.current = true
          setIsLoadingNotes(false)
        }
      }
    }

    void loadNotes()

    return () => {
      isMounted = false
      notesSyncReadyRef.current = false
      notesSyncRevisionRef.current += 1

      if (noteSaveTimeoutRef.current) {
        clearTimeout(noteSaveTimeoutRef.current)
        noteSaveTimeoutRef.current = null
      }
    }
  }, [englishAskBridge, noteStorageRevision])

  useLayoutEffect(() => {
    notesSyncRevisionRef.current += 1
  }, [isLoadingNotes, isUpdatingNoteStorage, askNoteOperation, renamingNoteId])

  useEffect(() => {
    if (!englishAskBridge?.listNotes || !englishAskBridge.getNote) {
      return
    }

    let lastSyncError: string | null = null
    const synchronizer = createNotesSynchronizer({
      getSnapshot: () => ({
        activeNoteId: activeNoteIdRef.current,
        markdown: noteDraftRef.current,
        notes: notesSyncContextRef.current.notes,
        isDirty: isNoteDirtyRef.current,
        isBusy:
          !notesSyncReadyRef.current ||
          notesSyncContextRef.current.isBusy ||
          noteSavesInFlightRef.current > 0,
        revision: notesSyncRevisionRef.current
      }),
      listNotes: () => englishAskBridge.listNotes(),
      getNote: (noteId) => englishAskBridge.getNote(noteId),
      onNotes: (nextNotes) => {
        setNotes(nextNotes)
        setNoteContextMenu((menu) =>
          menu && nextNotes.some((note) => note.id === menu.noteId) ? menu : null
        )
        setSelectedNoteToUpdateId((selectedId) =>
          nextNotes.some((note) => note.id === selectedId) ? selectedId : nextNotes[0]?.id ?? ''
        )
      },
      onDocument: updateActiveNote,
      onEmpty: () => {
        notesSyncRevisionRef.current += 1
        activeNoteIdRef.current = null
        noteDraftRef.current = ''
        isNoteDirtyRef.current = false
        setActiveNoteId(null)
        setNoteDraft('')
        setNoteImageError(null)
      },
      onError: (message) => {
        if (message && message !== lastSyncError) {
          console.warn('Notes 目录 synchronization failed', message)
        }
        lastSyncError = message
        setNoteSyncError(message)
      }
    })

    const refreshVisibleNotes = (): void => {
      if (document.visibilityState !== 'hidden') {
        void synchronizer.refresh()
      }
    }
    const interval = setInterval(refreshVisibleNotes, NOTES_SYNC_INTERVAL_MS)
    window.addEventListener('focus', refreshVisibleNotes)
    document.addEventListener('visibilitychange', refreshVisibleNotes)

    return () => {
      synchronizer.dispose()
      clearInterval(interval)
      window.removeEventListener('focus', refreshVisibleNotes)
      document.removeEventListener('visibilitychange', refreshVisibleNotes)
    }
  }, [englishAskBridge, noteStorageRevision])

  useEffect(() => {
    if (typeof localStorage === 'undefined') {
      return
    }

    try {
      localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(persistAskRequests(chatSessions, askRequests)))
    } catch (error) {
      console.warn('Unable to save chat history', error)
    }
  }, [chatSessions, askRequests])

  useEffect(() => {
    try {
      localStorage.setItem(ASKS_LIST_WIDTH_STORAGE_KEY, String(asksListWidth))
    } catch (error) {
      console.warn('Unable to save Asks 列表 width', error)
    }
  }, [asksListWidth])

  useEffect(() => {
    try {
      localStorage.setItem(NOTES_LIST_WIDTH_STORAGE_KEY, String(notesListWidth))
    } catch (error) {
      console.warn('Unable to save Notes 列表 width', error)
    }
  }, [notesListWidth])

  useEffect(() => {
    const handleWindowResize = (): void => {
      setAsksListWidth((currentWidth) =>
        clampListPanelWidth(currentWidth, window.innerWidth)
      )
      setNotesListWidth((currentWidth) =>
        clampListPanelWidth(currentWidth, window.innerWidth)
      )
    }

    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [])

  useEffect(() => {
    if (resizingListPanel === null) {
      return
    }

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (event: globalThis.PointerEvent): void => {
      const nextWidth =
        listPanelResizeStartRef.current.width +
        event.clientX -
        listPanelResizeStartRef.current.pointerX

      if (resizingListPanel === 'asks') {
        setAsksListWidth(clampListPanelWidth(nextWidth, window.innerWidth))
      } else {
        setNotesListWidth(clampListPanelWidth(nextWidth, window.innerWidth))
      }
    }

    const handlePointerUp = (): void => {
      setResizingListPanel(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [resizingListPanel])

  useLayoutEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useLayoutEffect(() => {
    chatSessionsRef.current = chatSessions
  }, [chatSessions])

  useLayoutEffect(() => {
    if (!activeSessionId || pendingConversationScrollSessionIdRef.current !== activeSessionId) {
      return
    }

    const conversation = conversationRef.current

    if (!conversation) {
      return
    }

    conversation.scrollTop = getRestoredConversationScrollTop(
      conversationScrollPositionsRef.current.get(activeSessionId),
      {
        clientHeight: conversation.clientHeight,
        scrollHeight: conversation.scrollHeight
      }
    )
    shouldFollowConversationScrollRef.current = shouldAutoScrollConversation({
      clientHeight: conversation.clientHeight,
      scrollHeight: conversation.scrollHeight,
      scrollTop: conversation.scrollTop
    })
    pendingConversationScrollSessionIdRef.current = null
    didRestoreConversationScrollRef.current = true
  }, [activeSessionId])

  useLayoutEffect(() => {
    const pendingAnswer = pendingCompletedAnswerRef.current

    if (!pendingAnswer) {
      return
    }

    pendingCompletedAnswerRef.current = null

    if (
      pendingAnswer.sessionId !== activeSessionId ||
      !shouldFollowConversationScrollRef.current
    ) {
      return
    }

    const conversation = conversationRef.current
    const answer = messageElementRefs.current.get(pendingAnswer.messageId)
    const questionElement = messageElementRefs.current.get(pendingAnswer.questionMessageId)

    if (!conversation || !answer || !questionElement) {
      return
    }

    const conversationBounds = conversation.getBoundingClientRect()
    const answerBounds = answer.getBoundingClientRect()
    const questionBounds = questionElement.getBoundingClientRect()
    const questionStartScrollTop = getCompletedQuestionStartScrollTop({
      answerBottom: answerBounds.bottom,
      questionTop: questionBounds.top,
      clientHeight: conversation.clientHeight,
      conversationScrollTop: conversation.scrollTop,
      conversationTop: conversationBounds.top,
      scrollHeight: conversation.scrollHeight
    })

    if (questionStartScrollTop === null) {
      return
    }

    conversation.scrollTop = questionStartScrollTop
    conversationScrollPositionsRef.current.set(activeSessionId, questionStartScrollTop)
    shouldFollowConversationScrollRef.current = false
  }, [activeSessionId, messages.length])

  useEffect(() => {
    if (didRestoreConversationScrollRef.current) {
      didRestoreConversationScrollRef.current = false
      return
    }

    if (!shouldFollowConversationScrollRef.current) {
      return
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      const conversation = conversationRef.current

      if (!conversation) {
        return
      }

      conversation.scrollTo({
        top: conversation.scrollHeight,
        behavior: 'smooth'
      })
    })

    return () => window.cancelAnimationFrame(animationFrameId)
  }, [messages.length, isSending])

  useLayoutEffect(() => {
    const pendingSessionId = pendingFocusedAskInputSessionIdRef.current

    if (
      !pendingSessionId ||
      pendingSessionId !== activeSessionId ||
      activeView !== 'chat' ||
      activeWorkspace !== 'asks'
    ) {
      return
    }

    const questionInput = questionInputRef.current

    if (!questionInput) {
      return
    }

    questionInput.focus()
    pendingFocusedAskInputSessionIdRef.current = null
  }, [activeSessionId, activeView, activeWorkspace])

  useEffect(() => {
    if (!historyContextMenu && !noteContextMenu) {
      return
    }

    const closeContextMenus = (): void => {
      setHistoryContextMenu(null)
      setNoteContextMenu(null)
    }

    const handleContextMenuKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeContextMenus()
      }
    }

    window.addEventListener('click', closeContextMenus)
    window.addEventListener('resize', closeContextMenus)
    window.addEventListener('keydown', handleContextMenuKeyDown)

    return () => {
      window.removeEventListener('click', closeContextMenus)
      window.removeEventListener('resize', closeContextMenus)
      window.removeEventListener('keydown', handleContextMenuKeyDown)
    }
  }, [historyContextMenu, noteContextMenu])

  useEffect(() => {
    setAskNoteTopics([])
    setSelectedAskNoteTopicIds([])
    setIsSelectingAskNoteTopics(false)
    setIsSelectingNoteToUpdate(false)
  }, [activeSessionId, messages.length])

  useEffect(() => {
    if (!confirmationDialog) {
      return
    }

    const handleConfirmationKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setConfirmationDialog(null)
      }
    }

    window.addEventListener('keydown', handleConfirmationKeyDown)

    return () => window.removeEventListener('keydown', handleConfirmationKeyDown)
  }, [confirmationDialog])

  const startNewAsk = (): void => {
    const nextSession = createChatSession()

    saveActiveConversationScrollPosition()
    shouldFollowConversationScrollRef.current = true
    pendingConversationScrollSessionIdRef.current = nextSession.id
    pendingFocusedAskInputSessionIdRef.current = nextSession.id
    setHistoryContextMenu(null)
    setHistorySearch('')
    setRenamingSessionId(null)
    setChatSessions((currentSessions) => [nextSession, ...currentSessions])
    setActiveSessionId(nextSession.id)
    setActiveView('chat')
    setActiveWorkspace('asks')
    setQuestion('')
    setError(null)
  }

  const startNewNote = async (): Promise<void> => {
    pendingFocusedNoteInputIdRef.current = null
    setActiveView('chat')
    setActiveWorkspace('notes')
    setNotesSearch('')

    if (!englishAskBridge?.createNote) {
      setNoteImageError('请在桌面应用中管理 Notes 存储。')
      return
    }

    if (!(await flushPendingNoteSave())) {
      return
    }

    setIsLoadingNotes(true)

    try {
      const result = await englishAskBridge.createNote({ markdown: '' })

      if (!result.ok) {
        throw new Error(result.error)
      }

      updateActiveNote(result.data)
      pendingFocusedNoteInputIdRef.current = result.data.id
      setRenamingNoteId(null)
      setNoteRenameSurface(null)
      setNoteRenameDraft('')
      setNoteImageError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法新建 Note。'
      setNoteImageError(message)
    } finally {
      setIsLoadingNotes(false)
    }
  }

  useEffect(() => {
    const handleNewItemShortcut = (event: globalThis.KeyboardEvent): void => {
      if (
        !isNewItemShortcut(event) ||
        noteUpdatePreview !== null ||
        ankiSource !== null || isOpeningAnki ||
        activeView !== 'chat' ||
        confirmationDialog !== null
      ) {
        return
      }

      event.preventDefault()

      if (activeWorkspace === 'asks') {
        startNewAsk()
        return
      }

      if (!isLoadingNotes) {
        void startNewNote()
      }
    }

    window.addEventListener('keydown', handleNewItemShortcut, true)
    return () => window.removeEventListener('keydown', handleNewItemShortcut, true)
  }, [activeView, activeWorkspace, confirmationDialog, isLoadingNotes, startNewAsk, startNewNote, noteUpdatePreview, ankiSource, isOpeningAnki])

  useEffect(() => {
    const pendingNoteId = pendingFocusedNoteInputIdRef.current

    if (
      !pendingNoteId ||
      pendingNoteId !== activeNoteId ||
      isLoadingNotes ||
      confirmationDialog !== null ||
      activeView !== 'chat' ||
      activeWorkspace !== 'notes'
    ) {
      return
    }

    // Wait for the child editor's initialization and editable-state effects.
    const animationFrameId = window.requestAnimationFrame(() => {
      if (pendingFocusedNoteInputIdRef.current !== pendingNoteId || !noteEditorRef.current) {
        return
      }

      noteEditorRef.current.focus()
      pendingFocusedNoteInputIdRef.current = null
    })

    return () => window.cancelAnimationFrame(animationFrameId)
  }, [
    activeNoteId,
    activeView,
    activeWorkspace,
    isLoadingNotes,
    confirmationDialog
  ])

  const getCurrentAskNoteMessages = (): ChatMessage[] =>
    messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: getMessageMarkdownContent(message),
      ...(getAnswerTags(message).length ? { answerTags: getAnswerTags(message) } : {}),
      createdAt: message.createdAt,
      ...(message.routerDiagnostic ? { routerDiagnostic: message.routerDiagnostic } : {})
    }))

  const openFormattedNote = (note: NoteDocument): void => {
    updateActiveNote(note)
    setNotesSearch('')
    setRenamingNoteId(null)
    setNoteRenameSurface(null)
    setNoteRenameDraft('')
    setNoteImageError(null)
    setActiveView('chat')
    setActiveWorkspace('notes')
  }

  const createPlannedAskNotes = async (
    topics: AskNoteTopic[],
    shouldCombineTopics: boolean
  ): Promise<void> => {
    if (!englishAskBridge?.createNote || !englishAskBridge.formatAskNote) {
      throw new Error('请在桌面应用中将 Ask 整理为 Notes。')
    }

    if (topics.length === 0) {
      throw new Error('请至少选择一个 Ask 主题来创建 Note。')
    }

    const askMessages = getCurrentAskNoteMessages()
    const messageGroups = shouldCombineTopics
      ? [getMessagesForAskNoteTopics(askMessages, topics)]
      : topics.map(topic => getMessagesForAskNoteTopics(askMessages, [topic]))

    if (messageGroups.some(group => getAskNoteOriginalMarkdown(group).length === 0)) {
      throw new Error('每个所选 Ask 主题都需要包含一条 AI 回答。')
    }

    const createdNotes: NoteDocument[] = []

    for (const topicMessages of messageGroups) {
      const formattedResult = await englishAskBridge.formatAskNote({
        operation: 'create',
        askId: activeSession?.id,
        messages: topicMessages
      })
      if (!formattedResult.ok) throw new Error(formattedResult.error)
      const createdResult = await englishAskBridge.createNote({
        name: getGeneratedNoteTitle(formattedResult.data.title || getAskNoteQuestion(topicMessages)),
        markdown: formattedResult.data.markdown
      })

      if (!createdResult.ok) {
        throw new Error(createdResult.error)
      }

      createdNotes.push(createdResult.data)
    }

    const lastCreatedNote = createdNotes.at(-1)

    if (!lastCreatedNote) {
      throw new Error('未能根据所选 Ask 主题创建 Notes。')
    }

    setNotes((currentNotes) =>
      createdNotes.reduce(
        (nextNotes, createdNote) => upsertNoteSummary(nextNotes, createdNote),
        currentNotes
      )
    )
    openFormattedNote(lastCreatedNote)
  }

  const createNoteFromAsk = async (): Promise<void> => {
    if (askNoteOperation !== null || messages.length === 0) {
      return
    }

    if (
      !englishAskBridge?.planAskNotes ||
      !englishAskBridge.createNote ||
      !englishAskBridge.formatAskNote
    ) {
      setError('请在桌面应用中将 Ask 整理为 Notes。')
      return
    }

    setAskNoteOperation('plan')
    setAskNoteTopics([])
    setSelectedAskNoteTopicIds([])
    setIsSelectingAskNoteTopics(false)
    setIsSelectingNoteToUpdate(false)
    setError(null)

    try {
      const planResult = await englishAskBridge.planAskNotes({
        messages: getCurrentAskNoteMessages()
      })

      if (!planResult.ok) {
        throw new Error(planResult.error)
      }

      if (planResult.data.topics.length === 1) {
        setAskNoteOperation('create')
        await createPlannedAskNotes(planResult.data.topics, false)
        return
      }

      setAskNoteTopics(planResult.data.topics)
      setSelectedAskNoteTopicIds(planResult.data.topics.map((topic) => topic.id))
      setIsSelectingAskNoteTopics(true)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '无法创建整理后的 Notes。'
      setError(errorMessage)
    } finally {
      setAskNoteOperation(null)
    }
  }

  const createSelectedAskNoteTopics = async (
    shouldCombineTopics: boolean
  ): Promise<void> => {
    if (askNoteOperation !== null) {
      return
    }

    const selectedTopics = getSelectedAskNoteTopics(
      askNoteTopics,
      selectedAskNoteTopicIds
    )

    if (selectedTopics.length === 0) {
      setError('请至少选择一个 Ask 主题来创建 Note。')
      return
    }

    setAskNoteOperation('create')
    setError(null)

    try {
      await createPlannedAskNotes(selectedTopics, shouldCombineTopics)
      setAskNoteTopics([])
      setSelectedAskNoteTopicIds([])
      setIsSelectingAskNoteTopics(false)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '无法创建整理后的 Notes。'
      setError(errorMessage)
    } finally {
      setAskNoteOperation(null)
    }
  }

  const showNoteUpdatePicker = (): void => {
    if (notes.length === 0) {
      setError('请先创建 Note，再将本次 Ask 的内容合并进去。')
      return
    }

    const defaultNoteId = notes.some((note) => note.id === activeNoteId)
      ? activeNoteId ?? notes[0].id
      : notes[0].id

    setSelectedNoteToUpdateId(defaultNoteId)
    setAskNoteTopics([])
    setSelectedAskNoteTopicIds([])
    setIsSelectingAskNoteTopics(false)
    setIsSelectingNoteToUpdate(true)
    setError(null)
  }

  const updateNoteFromAsk = async (): Promise<void> => {
    if (askNoteOperation !== null || noteUpdateInFlightRef.current || selectedNoteToUpdateId.length === 0) {
      return
    }

    if (
      !englishAskBridge?.getNote ||
      !englishAskBridge.formatAskNote ||
      !englishAskBridge.saveNote
    ) {
      setError('请在桌面应用中使用 AI 整理 Notes。')
      return
    }

    const directory = settings?.noteStorageDirectory
    if (!directory) {
      setError('笔记目录尚未加载，请稍后重试。')
      return
    }
    noteUpdateInFlightRef.current = true
    setAskNoteOperation('update')
    setError(null)

    try {
      if (!(await flushPendingNoteSave())) {
        throw new Error('无法保存当前 Note，暂不能更新。')
      }

      const existingNoteResult = await englishAskBridge.getNote(selectedNoteToUpdateId)

      if (!existingNoteResult.ok) {
        throw new Error(existingNoteResult.error)
      }

      const formattedResult = await englishAskBridge.formatAskNote({
        operation: 'update',
        askId: activeSession?.id,
        messages: getCurrentAskNoteMessages(),
        existingNote: existingNoteResult.data
      })

      if (!formattedResult.ok) {
        throw new Error(formattedResult.error)
      }

      setNoteUpdateError(null)
      setNoteUpdatePreview({
        original: existingNoteResult.data,
        markdown: formattedResult.data.markdown,
        directory
      })
      setIsSelectingNoteToUpdate(false)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '无法更新所选 Note。'
      setError(errorMessage)
    } finally {
      noteUpdateInFlightRef.current = false
      setAskNoteOperation(null)
    }
  }

  const confirmNoteUpdate = async (): Promise<void> => {
    if (!noteUpdatePreview || noteUpdateInFlightRef.current || !englishAskBridge?.saveNote) return
    const preview = noteUpdatePreview
    noteUpdateInFlightRef.current = true
    setIsSavingNoteUpdate(true)
    setNoteUpdateError(null)
    try {
      if (!(await flushPendingNoteSave())) throw new Error('无法保存当前笔记，请先处理保存错误。')
      const result = await englishAskBridge.saveNote({
        id: preview.original.id,
        markdown: preview.markdown,
        expectedMarkdown: preview.original.markdown,
        expectedDirectory: preview.directory,
        preservePrevious: true
      })
      if (!result.ok) throw new Error(result.error)
      setNoteUpdatePreview(null)
      openFormattedNote(result.data)
    } catch (error) {
      setNoteUpdateError(error instanceof Error ? error.message : '无法保存更新，请重试。')
    } finally {
      noteUpdateInFlightRef.current = false
      setIsSavingNoteUpdate(false)
    }
  }

  const undoNoteUpdate = async (): Promise<void> => {
    if (!recoverableNote || noteUpdateInFlightRef.current || !englishAskBridge?.saveNote ||
      !settings?.noteStorageDirectory) return
    const note = recoverableNote
    const directory = settings.noteStorageDirectory
    noteUpdateInFlightRef.current = true
    setIsLoadingNotes(true)
    setNoteImageError(null)
    try {
      if (!(await flushPendingNoteSave())) throw new Error('无法保存当前笔记，暂不能撤销。')
      const result = await englishAskBridge.saveNote({
        id: note.id,
        restorePrevious: true,
        expectedMarkdown: note.markdown,
        expectedDirectory: directory
      })
      if (!result.ok) throw new Error(result.error)
      updateActiveNote(result.data)
    } catch (error) {
      setNoteImageError(error instanceof Error ? error.message : '无法撤销更新。')
    } finally {
      noteUpdateInFlightRef.current = false
      setIsLoadingNotes(false)
    }
  }

  const selectNote = async (noteId: string): Promise<void> => {
    if (noteId === activeNoteId || !englishAskBridge?.getNote) {
      return
    }

    if (!(await flushPendingNoteSave())) {
      return
    }

    setIsLoadingNotes(true)
    setNoteContextMenu(null)
    setRenamingNoteId(null)

    try {
      const result = await englishAskBridge.getNote(noteId)

      if (!result.ok) {
        throw new Error(result.error)
      }

      updateActiveNote(result.data)
      setNoteImageError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法加载 Note。'
      setNoteImageError(message)
    } finally {
      setIsLoadingNotes(false)
    }
  }

  const startRenamingNote = (
    note: NoteSummary,
    renameSurface: 'list' | 'title'
  ): void => {
    setNoteContextMenu(null)
    setRenamingNoteId(note.id)
    setNoteRenameSurface(renameSurface)
    setNoteRenameDraft(note.title)
    setNoteImageError(null)
  }

  const cancelRenamingNote = (): void => {
    setRenamingNoteId(null)
    setNoteRenameSurface(null)
    setNoteRenameDraft('')
  }

  const commitNoteRename = async (noteId: string): Promise<void> => {
    if (isNoteRenameInFlightRef.current) {
      return
    }

    const normalizedName = noteRenameDraft.trim()

    if (normalizedName.length === 0) {
      setNoteImageError('Note 名称不能为空。')
      return
    }

    const currentNote = notes.find((note) => note.id === noteId)

    if (currentNote?.title === normalizedName) {
      cancelRenamingNote()
      setNoteImageError(null)
      return
    }

    if (!englishAskBridge?.renameNote) {
      setNoteImageError('请在桌面应用中重命名 Note。')
      return
    }

    if (!(await flushPendingNoteSave())) {
      return
    }

    isNoteRenameInFlightRef.current = true
    setIsLoadingNotes(true)

    try {
      const result = await englishAskBridge.renameNote({
        id: noteId,
        name: normalizedName
      })

      if (!result.ok) {
        throw new Error(result.error)
      }

      setNotes((currentNotes) =>
        replaceRenamedNoteSummary(currentNotes, noteId, result.data)
      )

      if (activeNoteIdRef.current === noteId) {
        updateActiveNote(result.data)
      }

      cancelRenamingNote()
      setNoteImageError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法重命名 Note。'
      setNoteImageError(message)
    } finally {
      isNoteRenameInFlightRef.current = false
      setIsLoadingNotes(false)
    }
  }

  const handleNoteRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      skipNextNoteRenameBlurRef.current = true
      cancelRenamingNote()
    }
  }

  const handleNoteTitleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      skipNextNoteRenameBlurRef.current = true
      cancelRenamingNote()
      event.currentTarget.blur()
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
    }
  }

  const startEditingActiveNoteTitle = (): void => {
    if (!activeNote || isLoadingNotes || isEditingActiveNoteTitle) {
      return
    }

    startRenamingNote(activeNote, 'title')
  }

  const handleActiveNoteTitleBlur = (): void => {
    if (activeNote && isEditingActiveNoteTitle) {
      handleNoteRenameBlur(activeNote.id)
    }
  }

  const handleNoteRenameBlur = (noteId: string): void => {
    if (skipNextNoteRenameBlurRef.current) {
      skipNextNoteRenameBlurRef.current = false
      return
    }

    void commitNoteRename(noteId)
  }

  const openNoteContextMenu = (
    event: MouseEvent<HTMLButtonElement>,
    noteId: string
  ): void => {
    event.preventDefault()

    const maxX = window.innerWidth - HISTORY_CONTEXT_MENU_WIDTH - CONTEXT_MENU_VIEWPORT_MARGIN
    const maxY = window.innerHeight - HISTORY_CONTEXT_MENU_HEIGHT - CONTEXT_MENU_VIEWPORT_MARGIN

    setNoteContextMenu({
      noteId,
      x: Math.max(CONTEXT_MENU_VIEWPORT_MARGIN, Math.min(event.clientX, maxX)),
      y: Math.max(CONTEXT_MENU_VIEWPORT_MARGIN, Math.min(event.clientY, maxY))
    })
  }

  const performDeleteNote = async (noteId: string): Promise<void> => {
    if (!englishAskBridge?.deleteNote) {
      setNoteImageError('请在桌面应用中删除 Note。')
      return
    }

    const isDeletingActiveNote = activeNoteIdRef.current === noteId

    setNoteContextMenu(null)

    if (isDeletingActiveNote && !(await flushPendingNoteSave())) {
      return
    }

    setIsLoadingNotes(true)

    try {
      const result = await englishAskBridge.deleteNote(noteId)

      if (!result.ok) {
        throw new Error(result.error)
      }

      if (!result.data.deleted) {
        setNoteImageError(null)
        return
      }

      const remainingNotes = sortNotesByFileName(
        notes.filter((note) => note.id !== result.data.id)
      )

      setNotes(remainingNotes)

      if (renamingNoteId === result.data.id) {
        cancelRenamingNote()
      }

      if (isDeletingActiveNote) {
        activeNoteIdRef.current = null
        noteDraftRef.current = ''
        isNoteDirtyRef.current = false
        setActiveNoteId(null)
        setNoteDraft('')

        const nextNote = remainingNotes[0]

        if (nextNote && englishAskBridge.getNote) {
          const nextNoteResult = await englishAskBridge.getNote(nextNote.id)

          if (!nextNoteResult.ok) {
            throw new Error(nextNoteResult.error)
          }

          updateActiveNote(nextNoteResult.data)
        }
      }

      setNoteImageError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法删除 Note。'
      setNoteImageError(message)
    } finally {
      setIsLoadingNotes(false)
    }
  }

  const deleteNote = (noteId: string): void => {
    const noteToDelete = notes.find((note) => note.id === noteId)

    setNoteContextMenu(null)

    if (!noteToDelete) {
      setNoteImageError('未找到 Note。')
      return
    }

    setConfirmationDialog({
      title: `将“${noteToDelete.id}”移到废纸篓？`,
      detail: '此 Markdown 文件将移到系统废纸篓，你可以从那里恢复。',
      confirmLabel: '移到废纸篓',
      onConfirm: () => performDeleteNote(noteId)
    })
  }

  useEffect(() => {
    const handleNoteRenameShortcut = (event: globalThis.KeyboardEvent): void => {
      if (
        event.key !== 'F2' ||
        activeView !== 'chat' ||
        activeWorkspace !== 'notes' ||
        !activeNoteId ||
        renamingNoteId !== null
      ) {
        return
      }

      const activeNote = notes.find((note) => note.id === activeNoteId)

      if (activeNote) {
        event.preventDefault()
        startRenamingNote(activeNote, 'title')
        noteTitleInputRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handleNoteRenameShortcut)
    return () => window.removeEventListener('keydown', handleNoteRenameShortcut)
  }, [activeNoteId, activeView, activeWorkspace, notes, renamingNoteId])

  const handleNoteChange = (markdown: string): void => {
    const noteId = activeNoteIdRef.current

    notesSyncRevisionRef.current += 1
    noteDraftRef.current = markdown
    isNoteDirtyRef.current = true
    setNoteDraft(markdown)

    if (!noteId) {
      return
    }

    if (noteSaveTimeoutRef.current) {
      clearTimeout(noteSaveTimeoutRef.current)
    }

    noteSaveTimeoutRef.current = setTimeout(() => {
      noteSaveTimeoutRef.current = null
      void persistNote(noteId, noteDraftRef.current)
    }, NOTE_AUTOSAVE_DELAY_MS)
  }

  const handleNotesBodyClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!activeNoteId || isLoadingNotes) {
      return
    }

    const clickTarget = event.target
    const clickedEditor = clickTarget instanceof Element && clickTarget.closest('.cm-editor') !== null

    if (clickedEditor) {
      return
    }

    noteEditorRef.current?.focus()
  }

  const startListPanelResize = (
    panel: AppWorkspace,
    currentWidth: number,
    event: React.PointerEvent<HTMLDivElement>
  ): void => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    listPanelResizeStartRef.current = {
      pointerX: event.clientX,
      width: currentWidth
    }
    setResizingListPanel(panel)
  }

  const handleListPanelResizeKeyDown = (
    panel: AppWorkspace,
    event: KeyboardEvent<HTMLDivElement>
  ): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }

    event.preventDefault()
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    const resizeWidth = (currentWidth: number): number =>
      clampListPanelWidth(
        currentWidth + direction * LIST_PANEL_KEYBOARD_RESIZE_STEP_PX,
        window.innerWidth
      )

    if (panel === 'asks') {
      setAsksListWidth(resizeWidth)
    } else {
      setNotesListWidth(resizeWidth)
    }
  }

  const toggleAskSearch = (): void => {
    if (isAskSearchVisible) {
      setHistorySearch('')
    }

    setIsAskSearchVisible((currentValue) => !currentValue)
  }

  const toggleNotesSearch = (): void => {
    if (isNotesSearchVisible) {
      setNotesSearch('')
    }

    setIsNotesSearchVisible((currentValue) => !currentValue)
  }

  const selectChatSession = (sessionId: string): void => {
    if (sessionId === activeSessionId) {
      setHistoryContextMenu(null)
      setActiveView('chat')
      setActiveWorkspace('asks')
      setError(null)
      return
    }

    saveActiveConversationScrollPosition()
    pendingConversationScrollSessionIdRef.current = sessionId
    setHistoryContextMenu(null)
    setActiveSessionId(sessionId)
    setActiveView('chat')
    setActiveWorkspace('asks')
    setError(null)
  }

  const openHistoryContextMenu = (
    event: MouseEvent<HTMLButtonElement>,
    sessionId: string
  ): void => {
    event.preventDefault()

    const maxX = window.innerWidth - HISTORY_CONTEXT_MENU_WIDTH - CONTEXT_MENU_VIEWPORT_MARGIN
    const maxY = window.innerHeight - HISTORY_CONTEXT_MENU_HEIGHT - CONTEXT_MENU_VIEWPORT_MARGIN

    setHistoryContextMenu({
      sessionId,
      x: Math.max(CONTEXT_MENU_VIEWPORT_MARGIN, Math.min(event.clientX, maxX)),
      y: Math.max(CONTEXT_MENU_VIEWPORT_MARGIN, Math.min(event.clientY, maxY))
    })
  }

  const startRenamingSession = (session: ChatSession): void => {
    setHistoryContextMenu(null)
    setRenamingSessionId(session.id)
    setRenameDraft(session.title)
  }

  const cancelRenamingSession = (): void => {
    setRenamingSessionId(null)
    setRenameDraft('')
  }

  const commitRenamingSession = (sessionId: string): void => {
    setChatSessions((currentSessions) => renameChatSession(currentSessions, sessionId, renameDraft))
    cancelRenamingSession()
  }

  const performDeleteSession = (sessionId: string): void => {
    if (askRequestsRef.current.get(sessionId)?.status === 'pending') {
      setError('请等待本次 Ask 回答结束后再删除。')
      return
    }

    try {
      conversationScrollPositionsRef.current.delete(sessionId)

      const remainingSessions = deleteChatSession(chatSessionsRef.current, sessionId)
      const nextSessions = remainingSessions.length > 0 ? remainingSessions : [createChatSession()]
      const nextActiveSessionId =
        getNextActiveChatSessionIdAfterDelete(nextSessions, sessionId, activeSessionId) ??
        nextSessions[0].id

      shouldFollowConversationScrollRef.current = true
      pendingConversationScrollSessionIdRef.current = nextActiveSessionId
      updateAskRequest({ type: 'remove', sessionId })
      setChatSessions(nextSessions)
      setActiveSessionId(nextActiveSessionId)
      setActiveView('chat')
      setError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法删除 Ask。'
      setError(message)
    }
  }

  const deleteSession = (sessionId: string): void => {
    const sessionToDelete = chatSessions.find((session) => session.id === sessionId)

    setHistoryContextMenu(null)
    setRenamingSessionId(null)

    if (askRequestsRef.current.get(sessionId)?.status === 'pending') {
      setError('请等待本次 Ask 回答结束后再删除。')
      return
    }

    if (!sessionToDelete) {
      setError(`Cannot delete missing chat session: ${sessionId}`)
      return
    }

    setConfirmationDialog({
      title: `删除“${sessionToDelete.title}”？`,
      detail: ASK_DELETE_CONFIRMATION_DETAIL,
      confirmLabel: '删除',
      onConfirm: () => performDeleteSession(sessionId)
    })
  }

  const handleRenameSubmit = (
    event: FormEvent<HTMLFormElement>,
    sessionId: string
  ): void => {
    event.preventDefault()
    commitRenamingSession(sessionId)
  }

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelRenamingSession()
    }
  }

  const handleConversationScroll = (): void => {
    const conversation = conversationRef.current

    if (!conversation) {
      return
    }

    if (activeSessionId) {
      conversationScrollPositionsRef.current.set(activeSessionId, conversation.scrollTop)
    }

    shouldFollowConversationScrollRef.current = shouldAutoScrollConversation({
      clientHeight: conversation.clientHeight,
      scrollHeight: conversation.scrollHeight,
      scrollTop: conversation.scrollTop
    })
  }

  const submitQuestion = async (retry = false, rejectedAnswer?: ChatMessage): Promise<void> => {
    if (isSavingSettings) return
    if (activeSession && askRequestsRef.current.get(activeSession.id)?.status === 'pending') {
      return
    }

    const retryQuestionIndex = rejectedAnswer && activeSession
      ? activeSession.messages.findIndex(message => message.id === rejectedAnswer.retryQuestionMessageId && message.role === 'user')
      : -1
    const retryMessage = rejectedAnswer && activeSession && retryQuestionIndex >= 0
      ? activeSession.messages[retryQuestionIndex]
      : retry && activeSession
      ? getRetryQuestion(askRequestsRef.current.get(activeSession.id), activeSession.messages)
      : undefined
    if ((retry || rejectedAnswer) && !retryMessage) return
    const normalizedQuestion = retryMessage?.content ?? question.trim()

    if (normalizedQuestion.length === 0) {
      return
    }

    if (!englishAskBridge) {
      setError(MISSING_BRIDGE_ERROR)
      return
    }

    if (!activeSession) {
      setError('请先新建 Ask。')
      return
    }

    const requestStartedAt = performance.now()
    const userMessage = retryMessage ?? createMessage('user', normalizedQuestion)
    const retryOfRequestId = rejectedAnswer?.retryRequestId
      ?? (retryMessage && !rejectedAnswer ? askRequestsRef.current.get(activeSession.id)?.requestId : undefined)
    const targetSessionId = activeSession.id
    const targetHistory = rejectedAnswer ? activeSession.messages.slice(0, retryQuestionIndex)
      : retryMessage ? activeSession.messages.slice(0, -1) : activeSession.messages
    const answerLanguage = DEFAULT_ANSWER_LANGUAGE
    const requestId =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

    if (!updateAskRequest({ type: 'start', requestId, sessionId: targetSessionId, questionMessageId: userMessage.id })) {
      return
    }

    shouldFollowConversationScrollRef.current = true
    setError(null)
    if (!retryMessage) {
      setQuestion('')
      setChatSessions((currentSessions) =>
        appendMessagesToSession(currentSessions, targetSessionId, [userMessage])
      )
    }

    let requestError: string | undefined

    try {
      const result = await englishAskBridge.askEnglish({
        requestId,
        ...(retryOfRequestId ? { retryOfRequestId } : {}),
        question: normalizedQuestion,
        history: targetHistory
      })
      const responseDurationMs = Math.max(0, Math.round(performance.now() - requestStartedAt))

      if (!isCurrentAskRequest(askRequestsRef.current, targetSessionId, requestId)) {
        return
      }

      if (result.ok) {
        const assistantMessage = createMessage(
          'assistant',
          result.data.answer,
          result.data.routerDiagnostic,
          result.data.knowledgeCard,
          result.data.answerLanguage ?? answerLanguage
        )
        assistantMessage.responseDurationMs = responseDurationMs
        if (result.data.answerTags) assistantMessage.answerTags = result.data.answerTags
        if (result.data.formatWarning) {
          assistantMessage.formatWarning = result.data.formatWarning
          assistantMessage.warningStage = result.data.warningStage
          assistantMessage.retryRequestId = requestId
          assistantMessage.retryQuestionMessageId = userMessage.id
        }
        if (rejectedAnswer) assistantMessage.id = rejectedAnswer.id

        if (activeSessionIdRef.current === targetSessionId) {
          pendingCompletedAnswerRef.current = {
            messageId: assistantMessage.id,
            questionMessageId: userMessage.id,
            sessionId: targetSessionId
          }
          setModelName(result.data.model)
        }

        setChatSessions((currentSessions) =>
          rejectedAnswer ? currentSessions.map(session => session.id === targetSessionId
            ? { ...session, updatedAt: assistantMessage.createdAt,
                messages: session.messages.map(message => message.id === rejectedAnswer.id ? assistantMessage : message) }
            : session)
            : appendMessagesToSession(currentSessions, targetSessionId, [assistantMessage])
        )
      } else {
        requestError = result.error
      }
    } catch {
      requestError = '无法连接桌面服务。'
    } finally {
      updateAskRequest({
        type: 'complete',
        sessionId: targetSessionId,
        requestId,
        error: requestError
      })
    }
  }

  const stopCurrentRequest = async (): Promise<void> => {
    const sessionId = activeSessionIdRef.current
    const activeRequest = sessionId ? askRequestsRef.current.get(sessionId) : undefined

    if (!sessionId || activeRequest?.status !== 'pending' || !englishAskBridge?.cancelAskEnglish) {
      return
    }

    updateAskRequest({ type: 'stop', sessionId, requestId: activeRequest.requestId })
    setError(null)

    try {
      const result = await englishAskBridge.cancelAskEnglish({
        requestId: activeRequest.requestId
      })

      if (!result.ok) {
        updateAskRequest({
          type: 'cancelFailed',
          sessionId,
          requestId: activeRequest.requestId,
          error: result.error
        })
      }
    } catch {
      updateAskRequest({
        type: 'cancelFailed',
        sessionId,
        requestId: activeRequest.requestId,
        error: '无法通过桌面服务停止回答。'
      })
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void submitQuestion()
  }

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (shouldSubmitComposerOnKeyDown(event)) {
      event.preventDefault()
      void submitQuestion()
    }
  }

  const handleSettingsSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    if (!englishAskBridge) {
      setSettingsMessage(SETTINGS_MISSING_BRIDGE_ERROR)
      return
    }

    setIsSavingSettings(true)
    setSettingsMessage(null)

    try {
      const result = await englishAskBridge.saveSettings({
        modelProvider: selectedModelProvider,
        apiKey: providerApiKey,
        modelName: selectedModelName,
        defaultAnswerLanguage: DEFAULT_ANSWER_LANGUAGE,
        systemPrompt
      })

      if (result.ok) {
        setSettings(result.data)
        setModelName(null)
        setSelectedModelProvider(result.data.modelProvider)
        setSelectedModelName(result.data.modelName)
        setSystemPrompt(result.data.systemPrompt)
        setProviderApiKey('')
        setIsEditingGeminiApiKey(false)
        setSettingsMessage(SETTINGS_SAVED_MESSAGE)
      } else {
        setSettingsMessage(result.error)
      }
    } catch {
      setSettingsMessage('无法连接桌面服务。')
    } finally {
      setIsSavingSettings(false)
    }
  }

  const handleJevSettingsSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!englishAskBridge || !settings) {
      setSettingsMessage(SETTINGS_MISSING_BRIDGE_ERROR)
      return
    }
    setIsSavingSettings(true)
    setSettingsMessage(null)
    try {
      const result = await englishAskBridge.saveSettings({
        modelProvider: settings.modelProvider,
        modelName: settings.modelName,
        defaultAnswerLanguage: settings.defaultAnswerLanguage,
        systemPrompt: settings.systemPrompt,
        jevChannel,
        ...(jevChannel === 'cloudflare' ? { jevCloudflareAccountId: jevAccountId } : {}),
        jevRoutingEnabled: jevRoutingEnabled ?? settings.jevRoutingEnabled ?? true,
        jevApiKey,
      })
      if (result.ok) {
        setSettings(result.data)
        setJevRoutingEnabled(undefined)
        setJevChannelDraft(undefined)
        if (jevChannel === 'cloudflare') setJevAccountIdDraft(undefined)
        setJevApiKey('')
        setIsEditingJevApiKey(false)
        setSettingsMessage(SETTINGS_SAVED_MESSAGE)
      } else {
        setSettingsMessage(result.error)
      }
    } catch {
      setSettingsMessage('无法连接桌面服务。')
    } finally {
      setIsSavingSettings(false)
    }
  }

  const chooseNotesDirectory = async (): Promise<void> => {
    if (!englishAskBridge?.chooseNoteStorageDirectory) {
      setSettingsMessage(SETTINGS_MISSING_BRIDGE_ERROR)
      return
    }

    if (!(await flushPendingNoteSave())) {
      setSettingsMessage('请先保存当前 Note，再更改存储目录。')
      return
    }
    notesSyncRevisionRef.current += 1
    setIsUpdatingNoteStorage(true)
    setSettingsMessage(null)

    try {
      const result = await englishAskBridge.chooseNoteStorageDirectory()

      if (!result.ok) {
        throw new Error(result.error)
      }

      setSettings(result.data.settings)

      if (result.data.changed) {
        setNoteStorageRevision((currentRevision) => currentRevision + 1)
        setSettingsMessage('Notes 存储目录已更新。')
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '无法选择 Notes 存储目录。'
      setSettingsMessage(message)
    } finally {
      setIsUpdatingNoteStorage(false)
    }
  }

  const resetNotesDirectory = async (): Promise<void> => {
    if (!englishAskBridge?.resetNoteStorageDirectory) {
      setSettingsMessage(SETTINGS_MISSING_BRIDGE_ERROR)
      return
    }

    if (!(await flushPendingNoteSave())) {
      setSettingsMessage('请先保存当前 Note，再更改存储目录。')
      return
    }
    notesSyncRevisionRef.current += 1
    setIsUpdatingNoteStorage(true)
    setSettingsMessage(null)

    try {
      const result = await englishAskBridge.resetNoteStorageDirectory()

      if (!result.ok) {
        throw new Error(result.error)
      }

      setSettings(result.data.settings)
      setNoteStorageRevision((currentRevision) => currentRevision + 1)
      setSettingsMessage('Notes 存储目录已恢复为默认目录。')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '无法重置 Notes 存储目录。'
      setSettingsMessage(message)
    } finally {
      setIsUpdatingNoteStorage(false)
    }
  }

  const confirmDeleteProviderKey = (): void => {
    const provider = selectedModelProvider
    const label = selectedProviderLabel
    setConfirmationDialog({
      title: `删除 ${label} 已保存的密钥？`,
      detail: '删除后立即生效，不影响其他服务商或模型选择。如配置了环境变量密钥，应用会继续使用它。',
      confirmLabel: '删除密钥',
      onConfirm: async () => {
        if (!englishAskBridge?.deleteProviderApiKey) {
          setSettingsMessage(SETTINGS_MISSING_BRIDGE_ERROR)
          return
        }
        setIsSavingSettings(true)
        setSettingsMessage(null)
        try {
          const result = await englishAskBridge.deleteProviderApiKey(provider)
          if (!result.ok) {
            setSettingsMessage(result.error)
            return
          }
          setSettings(result.data)
          setProviderApiKey('')
          setIsEditingGeminiApiKey(false)
          const source = result.data.providerSettings?.[provider]?.apiKeySource ??
            (result.data.modelProvider === provider ? result.data.apiKeySource : 'missing')
          setSettingsMessage(source === 'environment'
            ? `${label} 已保存的密钥已删除，正在使用环境变量密钥。`
            : `${label} 已保存的密钥已删除。`)
        } catch {
          setSettingsMessage('无法删除已保存的密钥，请重试。')
        } finally {
          setIsSavingSettings(false)
        }
      }
    })
  }

  const switchComposerModel = async (modelProvider: ModelProvider, nextModel: string): Promise<void> => {
    if (!englishAskBridge || !settings || isSavingSettings) return
    setIsSavingSettings(true)
    try {
      const result = await englishAskBridge.saveSettings({
        modelProvider, modelName: nextModel,
        defaultAnswerLanguage: settings.defaultAnswerLanguage,
        systemPrompt: settings.systemPrompt
      })
      if (!result.ok) throw new Error(result.error)
      setSettings(result.data)
      setModelName(null)
      setSelectedModelProvider(result.data.modelProvider)
      setSelectedModelName(result.data.modelName)
      setAvailableModelOptions([...new Set([result.data.modelName, ...DEFAULT_MODEL_OPTIONS_BY_PROVIDER[result.data.modelProvider]])])
      setProviderApiKey('')
      setIsEditingGeminiApiKey(false)
    } finally {
      setIsSavingSettings(false)
    }
  }

  const modelsSettingsContent = (
    <section className="settingsPage" aria-label="设置">
      <form className="settingsForm" onSubmit={handleSettingsSubmit}>
        <label className="fieldGroup">
          <span>服务商</span>
          <AppSelect
            aria-label="模型服务商"
            disabled={isSavingSettings || !englishAskBridge}
            onValueChange={(value) => {
              const nextProvider = value as ModelProvider
              const nextModel = settings?.providerSettings?.[nextProvider]?.modelName ??
                (settings?.modelProvider === nextProvider ? settings.modelName : undefined) ??
                DEFAULT_MODEL_OPTIONS_BY_PROVIDER[nextProvider][0]
              setSelectedModelProvider(nextProvider)
              setSelectedModelName(nextModel)
              setAvailableModelOptions([...new Set([
                nextModel, ...DEFAULT_MODEL_OPTIONS_BY_PROVIDER[nextProvider]
              ])])
              setProviderApiKey('')
              setIsEditingGeminiApiKey(false)
            }}
            value={selectedModelProvider}
          >
            {MODEL_PROVIDER_OPTIONS.map((providerOption) => (
              <option key={providerOption.id} value={providerOption.id}>
                {providerOption.label}
              </option>
            ))}
          </AppSelect>
        </label>

        <div className="fieldGroup">
          <label htmlFor="providerApiKey">{selectedProviderLabel} API 密钥</label>
          <div className="apiKeyInputRow">
          <input
            aria-label={`${selectedProviderLabel} API 密钥`}
            id="providerApiKey"
            disabled={isSavingSettings || !englishAskBridge}
            onBlur={() => {
              if (providerApiKey.length === 0) {
                setIsEditingGeminiApiKey(false)
              }
            }}
            onChange={(event) => {
              setIsEditingGeminiApiKey(true)
              setProviderApiKey(event.target.value)
            }}
            onFocus={() => setIsEditingGeminiApiKey(true)}
            type="password"
            value={providerApiKeyInputValue}
          />
          {selectedProviderSettings?.apiKeySource === 'app' ? (
            <button
              aria-label={`删除 ${selectedProviderLabel} 已保存的密钥`}
              title="删除已保存的密钥"
              className="deleteApiKeyButton"
              disabled={isSavingSettings || isLoadingModels || !englishAskBridge}
              onClick={confirmDeleteProviderKey}
              type="button"
            >
              <Trash2 size={18} aria-hidden="true" />
            </button>
          ) : null}
          </div>
          {selectedProviderSettings?.apiKeySource === 'environment' ? (
            <span className="apiKeySourceLabel">正在使用环境变量密钥</span>
          ) : null}
        </div>

        <div className="fieldGroup">
          <span className="fieldHeader">
            模型
            {canRefreshSelectedProviderModels ? (
              <button
                aria-label="刷新模型列表"
                className="refreshModelsButton"
                disabled={isLoadingModels || isSavingSettings || !englishAskBridge || !shouldShowModelNames}
                onClick={() => {
                  void loadProviderModels()
                }}
                type="button"
              >
                <RefreshModelsIcon />
              </button>
            ) : null}
          </span>
          <AppSelect
            aria-label="模型"
            disabled={isSavingSettings || !englishAskBridge || !shouldShowModelNames}
            onValueChange={setSelectedModelName}
            value={visibleSelectedModelName}
          >
            {shouldShowModelNames && !isSelectedModelAvailable ? (
              <option disabled value={selectedModelName}>
                {selectedModelName}（不可用）
              </option>
            ) : null}
            {visibleModelOptions.map((modelOption) => (
              <option key={modelOption} value={modelOption}>
                {modelOption}
              </option>
            ))}
          </AppSelect>
        </div>



        <button
          disabled={
            isSavingSettings ||
            !englishAskBridge ||
            (shouldShowModelNames && !isSelectedModelAvailable)
          }
          type="submit"
        >
          {isSavingSettings ? '保存中' : '保存设置'}
        </button>
      </form>

      {settingsMessage ? (
        <div className="settingsMessage" role="status">
          <InterfaceMessage message={settingsMessage} />
        </div>
      ) : null}
    </section>
  )

  const jevFieldsDisabled = isSavingSettings || !englishAskBridge || !(jevRoutingEnabled ?? settings?.jevRoutingEnabled ?? true)

  const jevSettingsContent = (
    <section className="settingsPage" aria-label="Jev 设置">
      <form className="settingsForm" onSubmit={handleJevSettingsSubmit}>
        <div className="fieldGroup">
          <label className="settingsCheckbox">
            <input type="checkbox" aria-label="启用 Jev 模型"
              disabled={isSavingSettings || !englishAskBridge}
              checked={jevRoutingEnabled ?? settings?.jevRoutingEnabled ?? true}
              onChange={event => setJevRoutingEnabled(event.target.checked)} />
            启用 Jev 模型
          </label>
          <small className="settingsFieldHint">仅用于问题分类，回答生成与复核仍使用当前模型。未配置 Jev 专用密钥或分类失败时使用原路由。</small>
        </div>

        <fieldset className="settingsFields" aria-label="Jev 配置" disabled={jevFieldsDisabled}>
          <label className="fieldGroup">
            <span>服务商</span>
            <AppSelect aria-label="Jev 服务商" value={jevChannel}
              disabled={jevFieldsDisabled}
              onValueChange={value => { setJevChannelDraft(value as JevChannel); setIsEditingJevApiKey(false); setSettingsMessage(null) }}>
              {(Object.entries(JEV_CHANNELS) as [JevChannel, typeof jevChannelInfo][]).map(([channel, info]) => (
                <option key={channel} value={channel}>{info.label}</option>
              ))}
            </AppSelect>
          </label>

          <div className="fieldGroup">
            <label htmlFor="jevApiKey">{jevChannelInfo.label} {jevChannel === 'cloudflare' ? 'API Token' : 'API 密钥'}</label>
            <input id="jevApiKey" type="password" autoComplete="new-password"
              disabled={jevFieldsDisabled}
              onFocus={() => setIsEditingJevApiKey(true)}
              onBlur={() => { if (!jevApiKey) setIsEditingJevApiKey(false) }}
              value={jevApiKeyInputValue}
              onChange={event => { setIsEditingJevApiKey(true); setJevApiKey(event.target.value) }} />
            <small className="settingsFieldHint">仅使用此处保存的专用密钥，不复用模型设置或环境变量中的密钥。</small>
          </div>

          {jevChannel === 'cloudflare' ? (
            <label className="fieldGroup">
              <span>Cloudflare Account ID</span>
              <input aria-label="Cloudflare Account ID" value={jevAccountId}
                disabled={jevFieldsDisabled}
                onChange={event => setJevAccountIdDraft(event.target.value)} />
              <small className="settingsFieldHint">填写此渠道专用的 32 位账户 ID。</small>
            </label>
          ) : null}

          <label className="fieldGroup">
            <span>模型</span>
            <input aria-label="Jev 模型" disabled={jevFieldsDisabled} readOnly value={jevChannelInfo.model} />
          </label>

        </fieldset>

        <button disabled={isSavingSettings || !englishAskBridge || !settings} type="submit">
          {isSavingSettings ? '保存中' : '保存设置'}
        </button>
      </form>
      {settingsMessage ? (
        <div className="settingsMessage" role="status">
          <InterfaceMessage message={settingsMessage} />
        </div>
      ) : null}
    </section>
  )

  const promptsSettingsContent = (
    <section className="settingsPage" aria-label="提示词">
      <div className="promptDesignList">
        <article className="promptDesignCard">
          <div className="promptDesignHeader">
            <h3>系统提示词</h3>
            <p>回答使用的基础指令，仅供查看。</p>
          </div>
          <textarea
            aria-label="系统提示词预览"
            className="systemPromptPreview"
            readOnly
            rows={8}
            value={systemPrompt}
          />
        </article>

        {PROMPT_DESIGN_SECTIONS.map((promptSection) => (
          <article className="promptDesignCard" key={promptSection.id}>
            <div className="promptDesignHeader">
              <h3>{promptSection.title}</h3>
              <p>{promptSection.description}</p>
            </div>
            <pre className="promptPreview">
              <code>{promptSection.prompt}</code>
            </pre>
          </article>
        ))}
      </div>

      {settingsMessage ? (
        <div className="settingsMessage" role="status">
          <InterfaceMessage message={settingsMessage} />
        </div>
      ) : null}
    </section>
  )

  const storageSettingsContent = (
    <section className="settingsPage" aria-label="Notes">
      <div className="settingsForm">
        <label className="fieldGroup">
          <span>Notes 目录</span>
          <input
            aria-label="Notes 目录"
            readOnly
            value={settings?.noteStorageDirectory ?? ''}
          />
        </label>

        <p className="storageSource">
          {settings?.noteStorageSource === 'custom'
            ? '正在使用自定义本地目录。'
            : '正在使用应用默认目录。'}
        </p>

        <div className="storageActions">
          <button
            disabled={isUpdatingNoteStorage || !englishAskBridge}
            onClick={() => {
              void chooseNotesDirectory()
            }}
            type="button"
          >
            {isUpdatingNoteStorage ? '更新中' : '选择目录'}
          </button>
          <button
            className="secondarySettingsButton"
            disabled={
              isUpdatingNoteStorage ||
              !englishAskBridge ||
              settings?.noteStorageSource !== 'custom'
            }
            onClick={() => {
              void resetNotesDirectory()
            }}
            type="button"
          >
            使用默认目录
          </button>
        </div>
      </div>

      {settingsMessage ? (
        <div className="settingsMessage" role="status">
          <InterfaceMessage message={settingsMessage} />
        </div>
      ) : null}
    </section>
  )

  const askListPanel = (
    <aside className="listPanel asksListPanel" aria-label="Asks 列表">
      <div className="listPanelHeader">
        <h2>Asks</h2>
        <div className="listPanelHeaderActions">
          <button
            aria-expanded={isAskSearchVisible}
            aria-label="搜索 Asks"
            className={
              isAskSearchVisible
                ? 'listPanelHeaderButton listPanelHeaderButton-active'
                : 'listPanelHeaderButton'
            }
            onClick={toggleAskSearch}
            type="button"
          >
            <SearchIcon />
          </button>
          <button
            aria-label="新建 Ask"
            className="listPanelHeaderButton"
            onClick={startNewAsk}
            title="新建 Ask（Cmd+N）"
            type="button"
          >
            <PlusLargeIcon />
          </button>
        </div>
      </div>

      {isAskSearchVisible ? (
        <label className="searchBox">
          <SearchIcon />
          <input
            aria-label="搜索 Asks"
            autoFocus
            onChange={(event) => setHistorySearch(event.target.value)}
            placeholder="搜索 Asks"
            value={historySearch}
          />
        </label>
      ) : null}

      <section className="historySection" aria-label="Asks">
        <div className="historyList">
          {sortedChatSessions.map((session) =>
            renamingSessionId === session.id ? (
              <form
                className={
                  session.id === activeSession?.id
                    ? 'historyRenameForm historyRenameForm-active'
                    : 'historyRenameForm'
                }
                key={session.id}
                onSubmit={(event) => handleRenameSubmit(event, session.id)}
              >
                <input
                  aria-label="重命名 Ask"
                  autoFocus
                  className="historyRenameInput"
                  onBlur={() => commitRenamingSession(session.id)}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={handleRenameKeyDown}
                  value={renameDraft}
                />
              </form>
            ) : (
              <button
                className={
                  session.id === activeSession?.id ? 'historyItem historyItem-active' : 'historyItem'
                }
                key={session.id}
                onClick={() => selectChatSession(session.id)}
                onContextMenu={(event) => openHistoryContextMenu(event, session.id)}
                type="button"
              >
                <span className="historyTitle">{session.title}</span>
              </button>
            )
          )}
        </div>
      </section>

      {historyContextMenu && historyContextMenuSession ? (
        <div
          aria-label="Ask 操作"
          className="historyContextMenu"
          onClick={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: historyContextMenu.x, top: historyContextMenu.y }}
        >
          <button
            onClick={() => startRenamingSession(historyContextMenuSession)}
            role="menuitem"
            type="button"
          >
            重命名
          </button>
          <button
            className="historyContextMenuDanger"
            disabled={askRequests.get(historyContextMenu.sessionId)?.status === 'pending'}
            onClick={() => deleteSession(historyContextMenu.sessionId)}
            role="menuitem"
            type="button"
          >
            删除
          </button>
        </div>
      ) : null}

      <div
        aria-label="调整 Asks 列表宽度"
        aria-orientation="vertical"
        aria-valuemax={clampListPanelWidth(
          MAX_LIST_PANEL_WIDTH_PX,
          window.innerWidth
        )}
        aria-valuemin={MIN_LIST_PANEL_WIDTH_PX}
        aria-valuenow={asksListWidth}
        className={
          resizingListPanel === 'asks'
            ? 'listPanelResizeHandle listPanelResizeHandle-active'
            : 'listPanelResizeHandle'
        }
        onKeyDown={(event) => handleListPanelResizeKeyDown('asks', event)}
        onPointerDown={(event) =>
          startListPanelResize('asks', asksListWidth, event)
        }
        role="separator"
        tabIndex={0}
      />
    </aside>
  )

  const notesListPanel = (
    <aside className="listPanel notesListPanel" aria-label="Notes 列表">
      <div className="listPanelHeader">
        <h2>Notes</h2>
        <div className="listPanelHeaderActions">
          <button
            aria-expanded={isNotesSearchVisible}
            aria-label="搜索 Notes"
            className={
              isNotesSearchVisible
                ? 'listPanelHeaderButton listPanelHeaderButton-active'
                : 'listPanelHeaderButton'
            }
            onClick={toggleNotesSearch}
            type="button"
          >
            <SearchIcon />
          </button>
          <button
            aria-label="新建 Note"
            className="listPanelHeaderButton"
            disabled={isLoadingNotes}
            onClick={() => {
              void startNewNote()
            }}
            title="新建 Note（Cmd+N）"
            type="button"
          >
            <PlusLargeIcon />
          </button>
        </div>
      </div>

      {isNotesSearchVisible ? (
        <label className="searchBox">
          <SearchIcon />
          <input
            aria-label="搜索 Notes"
            autoFocus
            onChange={(event) => setNotesSearch(event.target.value)}
            placeholder="搜索标题或 #标签"
            value={notesSearch}
          />
        </label>
      ) : null}

      {visibleNotes.length > 0 ? (
        <section className="historySection" aria-label="Notes">
          <div className="historyList">
            {visibleNotes.map((note) =>
              renamingNoteId === note.id && noteRenameSurface === 'list' ? (
                <form
                  className={
                    note.id === activeNoteId
                      ? 'historyRenameForm historyRenameForm-active'
                      : 'historyRenameForm'
                  }
                  key={note.id}
                  onSubmit={(event) => {
                    event.preventDefault()
                    void commitNoteRename(note.id)
                  }}
                >
                  <input
                    aria-label="重命名 Note"
                    autoFocus
                    className="historyRenameInput"
                    disabled={isLoadingNotes}
                    onBlur={() => handleNoteRenameBlur(note.id)}
                    onChange={(event) => setNoteRenameDraft(event.target.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={handleNoteRenameKeyDown}
                    value={noteRenameDraft}
                  />
                </form>
              ) : (
                <button
                  className={
                    note.id === activeNoteId ? 'historyItem historyItem-active' : 'historyItem'
                  }
                  disabled={isLoadingNotes}
                  key={note.id}
                  onClick={() => {
                    void selectNote(note.id)
                  }}
                  onContextMenu={(event) => openNoteContextMenu(event, note.id)}
                  type="button"
                >
                  <span className="historyTitle">{note.title}</span>
                </button>
              )
            )}
          </div>
        </section>
      ) : (
        <div className="listPanelEmpty">
          <p>
            {isLoadingNotes
              ? '正在加载 Notes'
              : notesSearch.trim().length > 0
                ? '没有匹配的 Notes'
                : '暂无 Notes'}
          </p>
        </div>
      )}

      {noteContextMenu ? (
        <div
          aria-label="Note 操作"
          className="historyContextMenu"
          onClick={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: noteContextMenu.x, top: noteContextMenu.y }}
        >
          <button
            onClick={() => {
              const note = notes.find((candidateNote) => candidateNote.id === noteContextMenu.noteId)

              if (note) {
                startRenamingNote(note, 'list')
              }
            }}
            role="menuitem"
            type="button"
          >
            重命名
          </button>
          <button
            className="historyContextMenuDanger"
            disabled={isLoadingNotes}
            onClick={() => {
              void deleteNote(noteContextMenu.noteId)
            }}
            role="menuitem"
            type="button"
          >
            删除
          </button>
        </div>
      ) : null}

      <div
        aria-label="调整 Notes 列表宽度"
        aria-orientation="vertical"
        aria-valuemax={clampListPanelWidth(
          MAX_LIST_PANEL_WIDTH_PX,
          window.innerWidth
        )}
        aria-valuemin={MIN_LIST_PANEL_WIDTH_PX}
        aria-valuenow={notesListWidth}
        className={
          resizingListPanel === 'notes'
            ? 'listPanelResizeHandle listPanelResizeHandle-active'
            : 'listPanelResizeHandle'
        }
        onKeyDown={(event) => handleListPanelResizeKeyDown('notes', event)}
        onPointerDown={(event) =>
          startListPanelResize('notes', notesListWidth, event)
        }
        role="separator"
        tabIndex={0}
      />
    </aside>
  )

  const askWorkspace = (
    <section className="workspace">
      <section className="chatLayout" aria-label="Ask 工作区">
        <section className="chatPanel" aria-label="当前 Ask">
            {messages.some((message) => message.role === 'assistant') ? (
              <section aria-label="整理为 Note" className="askNoteToolbar">
                <div className="askNoteToolbarMain">
                  <div className="askNoteToolbarActions">
                    <button
                      disabled={askNoteOperation !== null || isSending}
                      onClick={() => {
                        void createNoteFromAsk()
                      }}
                      type="button"
                    >
                      <FilePlus2 aria-hidden="true" size={16} />
                      {askNoteOperation === 'plan'
                        ? '分析中…'
                        : askNoteOperation === 'create'
                          ? '创建中…'
                          : '新建 Note'}
                    </button>
                    <button
                      disabled={askNoteOperation !== null || isSending}
                      onClick={showNoteUpdatePicker}
                      type="button"
                    >
                      <FilePenLine aria-hidden="true" size={16} />
                      更新 Note
                    </button>
                  </div>
                </div>
                {isSelectingAskNoteTopics ? (
                  <div className="askNoteTopicPicker">
                    <div className="askNoteTopicPickerHeader">
                      <strong>发现 {askNoteTopics.length} 个主题</strong>
                      <span>选择要整理为 Notes 的主题。</span>
                    </div>
                    <div aria-label="Ask 的 Note 主题" className="askNoteTopicList" role="group">
                      {askNoteTopics.map((topic) => (
                        <label className="askNoteTopicOption" key={topic.id}>
                          <input
                            checked={selectedAskNoteTopicIds.includes(topic.id)}
                            disabled={askNoteOperation !== null}
                            onChange={(event) =>
                              setSelectedAskNoteTopicIds((currentTopicIds) =>
                                updateAskNoteTopicSelection(
                                  currentTopicIds,
                                  topic.id,
                                  event.target.checked
                                )
                              )
                            }
                            type="checkbox"
                          />
                          <span>{topic.title}</span>
                        </label>
                      ))}
                    </div>
                    <div className="askNoteTopicPickerActions">
                      <button
                        disabled={askNoteOperation !== null}
                        onClick={() => {
                          setAskNoteTopics([])
                          setSelectedAskNoteTopicIds([])
                          setIsSelectingAskNoteTopics(false)
                        }}
                        type="button"
                      >
                        取消
                      </button>
                      <button
                        disabled={
                          askNoteOperation !== null || selectedAskNoteTopicIds.length < 2
                        }
                        onClick={() => {
                          void createSelectedAskNoteTopics(true)
                        }}
                        type="button"
                      >
                        合并所选主题
                      </button>
                      <button
                        disabled={
                          askNoteOperation !== null || selectedAskNoteTopicIds.length === 0
                        }
                        onClick={() => {
                          void createSelectedAskNoteTopics(false)
                        }}
                        type="button"
                      >
                        {askNoteOperation === 'create'
                          ? '创建中…'
                          : selectedAskNoteTopicIds.length === 1
                            ? '创建 Note'
                            : `创建 ${selectedAskNoteTopicIds.length} 个 Notes`}
                      </button>
                    </div>
                  </div>
                ) : null}
                {isSelectingNoteToUpdate ? (
                  <div className="askNoteUpdatePicker">
                    <label>
                      <span>选择要更新的 Note</span>
                      <AppSelect
                        aria-label="选择要更新的 Note"
                        disabled={askNoteOperation !== null}
                        onValueChange={setSelectedNoteToUpdateId}
                        value={selectedNoteToUpdateId}
                      >
                        {sortNotesByFileName(notes).map((note) => (
                          <option key={note.id} value={note.id}>
                            {note.title}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                    <div className="askNoteUpdatePickerActions">
                      <button
                        disabled={askNoteOperation !== null}
                        onClick={() => setIsSelectingNoteToUpdate(false)}
                        type="button"
                      >
                        取消
                      </button>
                      <button
                        disabled={askNoteOperation !== null}
                        onClick={() => {
                          void updateNoteFromAsk()
                        }}
                        type="button"
                      >
                        {askNoteOperation === 'update' ? '生成预览中…' : '生成更新预览'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}
          <div
            className="conversation"
            aria-live="polite"
            onScroll={handleConversationScroll}
            ref={conversationRef}
          >
            {messages.length === 0 ? (
              <div className="emptyState">
                <h2>今天想问什么关于英语的问题？</h2>
              </div>
            ) : (
              messages.map((message) => {
                const pronunciationTargets = getMessagePronunciationTargets(message)

                return (
                  <article
                    className={`message message-${message.role}`}
                    key={message.id}
                    ref={(element) => {
                      if (element) {
                        messageElementRefs.current.set(message.id, element)
                      } else {
                        messageElementRefs.current.delete(message.id)
                      }
                    }}
                  >
                    {getAnswerTags(message).length > 0 && <div className="answerTags" aria-label="回答标签">
                      {getAnswerTags(message).map(tag => <span key={tag}>#{tag}</span>)}
                    </div>}
                    {canPlayPronunciation ? pronunciationTargets.map(pronunciationTarget => {
                      const isSpeaking = speakingPronunciationId === getPronunciationPlaybackKey(message.id, pronunciationTarget)
                      return (
                      <div className="messagePronunciation" key={pronunciationTarget}>
                        <span>{pronunciationTarget}</span>
                        <button
                          aria-label={`${isSpeaking ? '停止' : '播放'} ${pronunciationTarget} 的发音`}
                          aria-pressed={isSpeaking}
                          className={isSpeaking ? 'messagePronunciationButton-active' : undefined}
                          onClick={() => {
                            void togglePronunciation(message, pronunciationTarget)
                          }}
                          title={isSpeaking ? '停止发音' : '播放发音'}
                          type="button"
                        >
                          {isSpeaking ? (
                            <Pause aria-hidden="true" size={14} strokeWidth={1.8} />
                          ) : (
                            <Volume2 aria-hidden="true" size={16} strokeWidth={2.2} />
                          )}
                        </button>
                      </div>
                      )
                    }) : null}
                    {message.formatWarning ? <>
                      <UnformattedAnswer output={message.content} />
                      <div className="answerFormatWarning" role="status">
                        <span>{message.warningStage === 'grammar'
                          ? '语法检查未完成，已保留原回答（未经完整校验）。'
                          : '回答格式未通过校验，已保留原内容（未经完整校验）。'}</span>
                        <button type="button" className="retryAskButton" disabled={isSending}
                          aria-label={message.warningStage === 'grammar' ? '重试语法检查' : '重试格式化回答'} onClick={() => void submitQuestion(false, message)}>
                          <RotateCcw size={16} aria-hidden="true" />重试
                        </button>
                        <details><summary>技术详情</summary><p>{message.formatWarning}</p></details>
                      </div>
                    </> : <MarkdownContent content={getMessageMarkdownContent(message)} />}
                    {import.meta.env.DEV && message.routerDiagnostic ? (
                      <RouterDiagnosticContent
                        diagnostic={message.routerDiagnostic}
                        cardType={message.knowledgeCard?.cardType}
                        responseDurationMs={message.responseDurationMs}
                      />
                    ) : null}
                  </article>
                )
              })
            )}

            {isSending ? (
              <article className="message message-assistant messagePending">
                <p>正在思考…</p>
              </article>
            ) : null}
          </div>

          {visibleError ? (
            <div className="errorMessage" role="alert">
              <InterfaceMessage message={visibleError} />
              {!error && activeSession && getRetryQuestion(activeAskRequest, activeSession.messages) ? (
                <button type="button" className="retryAskButton" aria-label="重新回答" title="重新回答"
                  onClick={() => void submitQuestion(true)}>
                  <RotateCcw size={16} aria-hidden="true" />
                  重试
                </button>
              ) : null}
            </div>
          ) : null}

          <form className="composer" onSubmit={handleSubmit}>
            <div className="composerSurface">
              <textarea
                aria-label="问题"
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handlePromptKeyDown}
                placeholder="输入你想了解的英语问题"
                ref={questionInputRef}
                rows={2}
                value={question}
              />
              <div className="composerActions">
                <ComposerModelMenu settings={settings} label={visibleComposerModelName ?? ''}
                  disabled={!englishAskBridge || isSavingSettings}
                  loadModels={provider => englishAskBridge!.listProviderModels({ modelProvider: provider })}
                  onSelect={switchComposerModel} />
                <div className="composerControls">
                  {isSending ? (
                    <button
                      aria-label="停止回答"
                      onClick={() => void stopCurrentRequest()}
                      title="停止回答"
                      type="button"
                    >
                      <StopIcon />
                    </button>
                  ) : (
                    <button
                      aria-label="发送"
                      disabled={!englishAskBridge || isSavingSettings || question.trim().length === 0}
                      type="submit"
                    >
                      <SendIcon />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </form>
        </section>
      </section>
    </section>
  )

  const notesWorkspace = (
    <section
      className={`workspace notesWorkspace${activeNoteId ? '' : ' notesWorkspace-empty'}`}
      aria-label="Notes 工作区"
      data-color-mode="dark"
    >
      {activeNoteId ? (
        <div className="notesEditorShell">
          <div className="notesEditorHeader">
            <button className="ankiNoteButton" type="button" onClick={() => void openAnkiDrafts()}
              disabled={isLoadingNotes || isOpeningAnki || isEditingActiveNoteTitle || !withoutNoteProvenance(noteDraft).trim()}>
              {isOpeningAnki ? '准备卡片…' : '生成 Anki 卡片'}
            </button>
            {recoverableNote?.id === activeNoteId && recoverableNote.markdown === noteDraft ? (
              <button
                className="undoNoteUpdateButton"
                type="button"
                disabled={isLoadingNotes}
                onClick={() => void undoNoteUpdate()}
                title="恢复到上次 AI 更新前的内容"
              >
                <Undo2 size={16} aria-hidden="true" />
                撤销上次更新
              </button>
            ) : null}
            <div aria-level={1} className="noteDocumentTitle" role="heading">
              <textarea
                aria-label="当前 Note 标题"
                className="noteTitleInput"
                disabled={!activeNote || isLoadingNotes}
                onBlur={handleActiveNoteTitleBlur}
                onChange={(event) => setNoteRenameDraft(event.target.value)}
                onFocus={startEditingActiveNoteTitle}
                onKeyDown={handleNoteTitleKeyDown}
                ref={noteTitleInputRef}
                rows={1}
                spellCheck={false}
                value={activeNoteTitleValue}
              />
            </div>
          </div>
          <div className="notesBodyFocusArea" onClick={handleNotesBodyClick}>
            <LiveMarkdownEditor
              disabled={isLoadingNotes || isOpeningAnki}
              key={activeNoteId}
              markdown={withoutNoteProvenance(noteDraft)}
              onChange={(body) => handleNoteChange(replaceNoteBody(noteDraft, body))}
              onUploadImage={uploadNoteImage}
              ref={noteEditorRef}
            />
          </div>
          {visibleNoteError ? (
            <div className="errorMessage" role="alert">
              <InterfaceMessage message={visibleNoteError} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )

  const ankiDraftDialogElement = ankiSource ? <AnkiDraftDialog note={ankiSource.note}
    directory={ankiSource.directory} onClose={() => setAnkiSource(null)} /> : null

  const confirmationDialogElement = confirmationDialog ? (
    <div
      aria-labelledby="confirmationDialogTitle"
      aria-modal="true"
      className="confirmationDialogOverlay"
      role="dialog"
    >
      <div className="confirmationDialog">
        <div className="confirmationDialogBody">
          <h2 id="confirmationDialogTitle">{confirmationDialog.title}</h2>
          <p>{confirmationDialog.detail}</p>
        </div>
        <div className="confirmationDialogActions">
          <button
            autoFocus
            className="confirmationDialogCancel"
            onClick={() => setConfirmationDialog(null)}
            type="button"
          >
            取消
          </button>
          <button
            className="confirmationDialogConfirm"
            onClick={() => {
              const confirmAction = confirmationDialog.onConfirm
              setConfirmationDialog(null)
              void confirmAction()
            }}
            type="button"
          >
            {confirmationDialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  ) : null

  const noteUpdatePreviewElement = noteUpdatePreview ? (
    <NoteUpdatePreview
      title={noteUpdatePreview.original.title}
      before={noteUpdatePreview.original.markdown}
      after={noteUpdatePreview.markdown}
      saving={isSavingNoteUpdate}
      error={noteUpdateError}
      onCancel={() => {
        if (!noteUpdateInFlightRef.current) setNoteUpdatePreview(null)
      }}
      onConfirm={() => void confirmNoteUpdate()}
    />
  ) : null

  if (activeView === 'settings') {
    return (
      <>
        <main className="settingsShell">
          <aside className="settingsSidebar" aria-label="设置导航">
            <button className="settingsBackButton" onClick={() => setActiveView('chat')} type="button">
              <BackIcon />
              返回
            </button>

            <nav className="settingsSidebarNav" aria-label="设置分类">
              <button
                className={
                  visibleSettingsSection === 'models'
                    ? 'settingsSidebarItem settingsSidebarItem-active'
                    : 'settingsSidebarItem'
                }
                onClick={() => setActiveSettingsSection('models')}
                type="button"
              >
                模型
              </button>
              <button
                className={visibleSettingsSection === 'jev'
                  ? 'settingsSidebarItem settingsSidebarItem-active' : 'settingsSidebarItem'}
                onClick={() => setActiveSettingsSection('jev')}
                type="button"
              >
                Jev（可选）
              </button>
              <button
                className={
                  visibleSettingsSection === 'prompts'
                    ? 'settingsSidebarItem settingsSidebarItem-active'
                    : 'settingsSidebarItem'
                }
                onClick={() => setActiveSettingsSection('prompts')}
                type="button"
              >
                提示词
              </button>
              <button
                className={
                  visibleSettingsSection === 'storage'
                    ? 'settingsSidebarItem settingsSidebarItem-active'
                    : 'settingsSidebarItem'
                }
                onClick={() => setActiveSettingsSection('storage')}
                type="button"
              >
                Notes
              </button>
            </nav>
          </aside>

          <section className="settingsWorkspace">
            {visibleSettingsSection === 'models'
              ? modelsSettingsContent
              : visibleSettingsSection === 'jev'
                ? jevSettingsContent
                : visibleSettingsSection === 'storage'
                  ? storageSettingsContent
                  : promptsSettingsContent}
          </section>
        </main>
        {confirmationDialogElement}
        {noteUpdatePreviewElement}
        {ankiDraftDialogElement}
      </>
    )
  }

  return (
    <>
      <main
        className="appShell"
        style={
          {
            '--list-panel-width': `${
              activeWorkspace === 'asks' ? asksListWidth : notesListWidth
            }px`
          } as CSSProperties
        }
      >
        <aside className="appSidebar" aria-label="主导航">
          <div className="sidebarHeader">
            <div className="sidebarBrand" aria-label="EnglishAsk 英问">
              <strong>EnglishAsk</strong>
              <span>英问</span>
            </div>
          </div>

          <nav className="sidebarNav" aria-label="主导航">
            <button
              className={getSidebarNavItemClassName(activeWorkspace === 'asks')}
              onClick={() => {
                setActiveView('chat')
                setActiveWorkspace('asks')
              }}
              type="button"
            >
              <NewAskIcon />
              Asks
            </button>
            <button
              className={getSidebarNavItemClassName(activeWorkspace === 'notes')}
              onClick={() => {
                setActiveView('chat')
                setActiveWorkspace('notes')
              }}
              type="button"
            >
              <NotesIcon />
              Notes
            </button>
            <button
              className="sidebarNavItem"
              onClick={() => {
                void flushPendingNoteSave().then((didSave) => {
                  if (didSave) {
                    setActiveView('settings')
                  }
                })
              }}
              type="button"
            >
              <SettingsIcon />
              设置
            </button>
          </nav>
        </aside>

        {activeWorkspace === 'asks' ? askListPanel : notesListPanel}
        {activeWorkspace === 'asks' ? askWorkspace : notesWorkspace}
      </main>
      {confirmationDialogElement}
      {noteUpdatePreviewElement}
      {ankiDraftDialogElement}
    </>
  )
}
