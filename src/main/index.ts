import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { localizeMenuLabels } from './menu-language'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { askEnglish } from './ai-service'
import { formatAskNote, planAskNotes } from './ask-note-service'
import { generateAnkiDrafts, loadAnkiDrafts, saveAnkiDrafts } from './anki-drafts'
import { exportAnkiCards } from './anki-export'
import { EXPORT_ANKI_CARDS_CHANNEL, GENERATE_ANKI_DRAFTS_CHANNEL, LOAD_ANKI_DRAFTS_CHANNEL, SAVE_ANKI_DRAFTS_CHANNEL } from '../shared/anki'
import { validateAskEnglishRequest, validateAskEnglishRequestId } from './ai-request'
import { AskRequestCancellationRegistry, isAbortError } from './ask-cancellation'
import { saveNoteImage } from './note-assets'
import { createNote, getNote, listNotes, renameNote, saveNote } from './note-storage'
import { moveNoteToSystemTrash } from './note-trash'
import {
  chooseNoteStorageDirectory,
  useDefaultNoteStorageDirectory
} from './note-storage-settings'
import { deleteProviderApiKey, getSettingsState, saveSettings } from './settings'
import { listProviderModels } from './provider-models'
import { PronunciationAudioService } from './pronunciation-audio'
import { captureTelemetryEvent, initializeTelemetry } from './telemetry'
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
  isTelemetryEventName,
  isTelemetryEventProperties,
  type AskEnglishResult,
  type CancelAskEnglishRequest,
  type CancelAskEnglishResult,
  type CreateNoteRequest,
  type DeleteNoteResult,
  type FormatAskNoteResult,
  type ProviderModelsResult,
  type NoteDocumentResult,
  type NoteStorageSettingsResult,
  type NotesListResult,
  type PlanAskNotesResult,
  type PronunciationAudioResult,
  type SaveNoteImageResult,
  type SettingsResult
} from '../shared/ai'

const WINDOW_WIDTH = 1080
const WINDOW_HEIGHT = 760
const PRELOAD_ENTRY = '../preload/index.mjs'
const PRONUNCIATION_CACHE_DIRECTORY_NAME = 'pronunciation-cache'
const askCancellationRegistry = new AskRequestCancellationRegistry()
let pronunciationAudioService: PronunciationAudioService | null = null

const getPronunciationAudioService = (): PronunciationAudioService => {
  pronunciationAudioService ??= new PronunciationAudioService(
    join(app.getPath('userData'), PRONUNCIATION_CACHE_DIRECTORY_NAME)
  )

  return pronunciationAudioService
}

const getCreateNoteRequest = (request: unknown): CreateNoteRequest => {
  if (typeof request !== 'object' || request === null || !('markdown' in request)) {
    throw new Error('Note creation request must include Markdown.')
  }

  if (typeof request.markdown !== 'string') {
    throw new Error('Note Markdown must be a string.')
  }

  if ('name' in request && request.name !== undefined && typeof request.name !== 'string') {
    throw new Error('Note name must be a string.')
  }

  return {
    markdown: request.markdown,
    ...('name' in request && request.name !== undefined ? { name: request.name } : {})
  }
}

const createWindow = (): BrowserWindow => {
  const mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 860,
    minHeight: 620,
    show: false,
    title: 'EnglishAsk',
    webPreferences: {
      preload: join(__dirname, PRELOAD_ENTRY),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

ipcMain.on(
  CAPTURE_TELEMETRY_EVENT_CHANNEL,
  (_, eventName: unknown, properties: unknown = {}) => {
    if (!isTelemetryEventName(eventName)) {
      console.warn('[Telemetry] Ignored invalid event name.')
      return
    }

    if (!isTelemetryEventProperties(properties)) {
      console.warn('[Telemetry] Ignored invalid event properties.')
      return
    }

    captureTelemetryEvent(eventName, properties)
  }
)

ipcMain.handle(ASK_ENGLISH_CHANNEL, async (_, request): Promise<AskEnglishResult> => {
  let activeRequest: { controller: AbortController; requestId: string } | null = null
  let requestStartedAt: number | null = null

  try {
    const validatedRequest = validateAskEnglishRequest(request)
    const controller = askCancellationRegistry.start(validatedRequest.requestId)
    activeRequest = { controller, requestId: validatedRequest.requestId }
    requestStartedAt = Date.now()
    captureTelemetryEvent('ask_submitted', {
      history_count: validatedRequest.history.length
    })
    const response = await askEnglish(validatedRequest, { signal: controller.signal })
    const classification =
      response.routerDiagnostic?.status === 'success'
        ? response.routerDiagnostic.classification
        : null

    captureTelemetryEvent('ask_completed', {
      outcome: 'success',
      duration_ms: Date.now() - requestStartedAt,
      model: response.model,
      router_status: response.routerDiagnostic?.status ?? 'not_included',
      input_type: classification?.inputType,
      intent: classification?.intent,
      response_mode: classification?.responseMode,
      has_knowledge_card: Boolean(response.knowledgeCard)
    })

    return {
      ok: true,
      data: response
    }
  } catch (error) {
    if (activeRequest?.controller.signal.aborted || isAbortError(error)) {
      if (requestStartedAt !== null) {
        captureTelemetryEvent('ask_completed', {
          outcome: 'cancelled',
          duration_ms: Date.now() - requestStartedAt
        })
      }

      return {
        ok: false,
        error: 'Request stopped.',
        cancelled: true
      }
    }

    const message = error instanceof Error ? error.message : 'Unable to complete the AI request.'

    console.error('EnglishAsk request failed', error)

    if (requestStartedAt !== null) {
      captureTelemetryEvent('ask_completed', {
        outcome: 'failed',
        duration_ms: Date.now() - requestStartedAt
      })
    }

    return {
      ok: false,
      error: message
    }
  } finally {
    if (activeRequest) {
      askCancellationRegistry.finish(activeRequest.requestId, activeRequest.controller)
    }
  }
})

ipcMain.handle(
  CANCEL_ASK_ENGLISH_CHANNEL,
  async (_, request: CancelAskEnglishRequest): Promise<CancelAskEnglishResult> => {
    try {
      const requestId = validateAskEnglishRequestId(request?.requestId)

      return {
        ok: true,
        cancelled: askCancellationRegistry.cancel(requestId)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to stop the AI request.'

      return {
        ok: false,
        error: message
      }
    }
  }
)

ipcMain.handle(GET_SETTINGS_CHANNEL, async (): Promise<SettingsResult> => {
  try {
    return {
      ok: true,
      data: await getSettingsState()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load settings.'

    console.error('EnglishAsk settings load failed', error)

    return {
      ok: false,
      error: message
    }
  }
})

ipcMain.handle(
  GET_PRONUNCIATION_AUDIO_CHANNEL,
  async (_, request: unknown): Promise<PronunciationAudioResult> => {
    try {
      return {
        ok: true,
        data: await getPronunciationAudioService().getAudio(request)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to generate pronunciation audio.'

      console.error('EnglishAsk pronunciation generation failed', error)

      return {
        ok: false,
        error: message
      }
    }
  }
)

ipcMain.handle(
  PLAN_ASK_NOTES_CHANNEL,
  async (_, request: unknown): Promise<PlanAskNotesResult> => {
    try {
      return {
        ok: true,
        data: await planAskNotes(request)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to plan Notes for this Ask.'

      console.error('EnglishAsk Ask-to-Note planning failed', error)

      return {
        ok: false,
        error: message
      }
    }
  }
)

ipcMain.handle(
  FORMAT_ASK_NOTE_CHANNEL,
  async (_, request: unknown): Promise<FormatAskNoteResult> => {
    try {
      return {
        ok: true,
        data: await formatAskNote(request)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to format the Ask as a Note.'

      console.error('EnglishAsk Ask-to-Note formatting failed', error)

      return {
        ok: false,
        error: message
      }
    }
  }
)

ipcMain.handle(EXPORT_ANKI_CARDS_CHANNEL, async (event, request: unknown) => {
  try {
    const data = await exportAnkiCards(request, async fileName => {
      const options = { title: '导出 Anki 卡片', buttonLabel: '导出',
        defaultPath: join(app.getPath('downloads'), fileName), filters: [{ name: 'Anki 导入文件', extensions: ['txt'] }] }
      const owner = BrowserWindow.fromWebContents(event.sender)
      const selection = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
      return selection.canceled ? undefined : selection.filePath
    })
    return { ok: true, data }
  } catch (error) {
    console.warn('Anki export failed.')
    return { ok: false, error: error instanceof Error ? error.message : '导出失败，请重试。' }
  }
})

for (const [channel, operation] of [
  [GENERATE_ANKI_DRAFTS_CHANNEL, generateAnkiDrafts],
  [LOAD_ANKI_DRAFTS_CHANNEL, loadAnkiDrafts],
  [SAVE_ANKI_DRAFTS_CHANNEL, saveAnkiDrafts]
] as const) {
  ipcMain.handle(channel, async (_, request: unknown) => {
    try { return { ok: true, data: await operation(request) } }
    catch (error) {
      console.warn('Anki draft operation failed', { channel })
      return { ok: false, error: error instanceof Error ? error.message : '卡片操作失败，请重试。' }
    }
  })
}

ipcMain.handle(DELETE_PROVIDER_API_KEY_CHANNEL, async (_, provider): Promise<SettingsResult> => {
  try {
    return { ok: true, data: await deleteProviderApiKey(provider) }
  } catch {
    console.error('EnglishAsk provider key deletion failed')
    return { ok: false, error: '无法删除已保存的密钥，请重试。' }
  }
})

ipcMain.handle(SAVE_SETTINGS_CHANNEL, async (_, request): Promise<SettingsResult> => {
  try {
    return {
      ok: true,
      data: await saveSettings(request)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save settings.'

    console.error('EnglishAsk settings save failed', error)

    return {
      ok: false,
      error: message
    }
  }
})

ipcMain.handle(LIST_PROVIDER_MODELS_CHANNEL, async (_, request): Promise<ProviderModelsResult> => {
  try {
    return {
      ok: true,
      data: await listProviderModels(request)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load provider models.'

    console.error('EnglishAsk provider model list failed', error)

    return {
      ok: false,
      error: message
    }
  }
})

ipcMain.handle(SAVE_NOTE_IMAGE_CHANNEL, async (_, request): Promise<SaveNoteImageResult> => {
  try {
    return {
      ok: true,
      data: await saveNoteImage(request)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save note image.'

    console.error('EnglishAsk note image save failed', error)

    return {
      ok: false,
      error: message
    }
  }
})

ipcMain.handle(LIST_NOTES_CHANNEL, async (): Promise<NotesListResult> => {
  try {
    return {
      ok: true,
      data: await listNotes()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load notes.'

    console.error('EnglishAsk notes list failed', error)

    return {
      ok: false,
      error: message
    }
  }
})

ipcMain.handle(CREATE_NOTE_CHANNEL, async (_, request: unknown): Promise<NoteDocumentResult> => {
  try {
    const createNoteRequest = getCreateNoteRequest(request)
    const note = await createNote(
      undefined,
      createNoteRequest.markdown,
      createNoteRequest.name
    )

    captureTelemetryEvent('note_created', {
      source: createNoteRequest.markdown.trim().length > 0 ? 'ask' : 'blank'
    })

    return {
      ok: true,
      data: note
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create note.'

    console.error('EnglishAsk note creation failed', error)

    return {
      ok: false,
      error: message
    }
  }
})

ipcMain.handle(GET_NOTE_CHANNEL, async (_, noteId): Promise<NoteDocumentResult> => {
  try {
    return {
      ok: true,
      data: await getNote(noteId)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load note.'

    console.error('EnglishAsk note load failed', error)

    return {
      ok: false,
      error: message
    }
  }
})

ipcMain.handle(SAVE_NOTE_CHANNEL, async (_, request): Promise<NoteDocumentResult> => {
  try {
    return {
      ok: true,
      data: await saveNote(request)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save note.'

    console.error('EnglishAsk note save failed', error)

    return {
      ok: false,
      error: message
    }
  }
})

ipcMain.handle(RENAME_NOTE_CHANNEL, async (_, request): Promise<NoteDocumentResult> => {
  try {
    return {
      ok: true,
      data: await renameNote(request)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to rename note.'

    console.error('EnglishAsk note rename failed', error)

    return {
      ok: false,
      error: message
    }
  }
})

ipcMain.handle(DELETE_NOTE_CHANNEL, async (_, noteId): Promise<DeleteNoteResult> => {
  try {
    return {
      ok: true,
      data: await moveNoteToSystemTrash(noteId)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete note.'

    console.error('EnglishAsk note deletion failed', error)

    return {
      ok: false,
      error: message
    }
  }
})

ipcMain.handle(
  CHOOSE_NOTE_STORAGE_DIRECTORY_CHANNEL,
  async (): Promise<NoteStorageSettingsResult> => {
    try {
      return await chooseNoteStorageDirectory()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to choose Notes storage directory.'

      console.error('EnglishAsk Notes directory selection failed', error)

      return {
        ok: false,
        error: message
      }
    }
  }
)

ipcMain.handle(
  RESET_NOTE_STORAGE_DIRECTORY_CHANNEL,
  async (): Promise<NoteStorageSettingsResult> => {
    try {
      return await useDefaultNoteStorageDirectory()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to reset Notes storage directory.'

      console.error('EnglishAsk Notes directory reset failed', error)

      return {
        ok: false,
        error: message
      }
    }
  }
)

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.english-ask.app')
  initializeTelemetry()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const mainWindow = createWindow()
  const menu = Menu.getApplicationMenu()
  if (menu) {
    localizeMenuLabels(menu)
    Menu.setApplicationMenu(menu)
  }
  mainWindow.webContents.once('did-finish-load', () => {
    captureTelemetryEvent('app_opened')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
