import { randomUUID } from 'node:crypto'
import {
  mkdir,
  lstat,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { readNoteUpdateBackup, writeNoteUpdateBackup } from './note-update-backup'
import type { DeleteNoteResponse, NoteDocument, NoteSummary } from '../shared/ai'
import { getConfiguredNoteStorageDirectory } from './settings'
import { extractNoteTags } from '../shared/note-tags'
import { mergeNoteSources, readNoteProvenance, withNoteProvenance, withoutNoteProvenance } from '../shared/note-provenance'

const NOTE_FILE_EXTENSION = '.md'
const MAX_TAG_CACHE_ENTRIES = 1_000
const noteTagCache = new Map<string, { signature: string; tags: string[] }>()
const NOTE_FILE_MODE = 0o600
const MAX_NOTE_BYTES = 2 * 1024 * 1024
const MAX_NOTE_FILE_NAME_BYTES = 255
const DEFAULT_NOTE_NAME = '未命名'
const MAX_DEFAULT_NOTE_NAME_ATTEMPTS = 10_000
let noteMutationQueue: Promise<void> = Promise.resolve()

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Note save request must be an object.')
  }
}

const normalizeNoteId = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    basename(value) !== value ||
    extname(value).toLowerCase() !== NOTE_FILE_EXTENSION ||
    Buffer.byteLength(value, 'utf8') > MAX_NOTE_FILE_NAME_BYTES
  ) {
    throw new Error('Note ID is invalid.')
  }

  return value
}

const normalizeMarkdown = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('Note Markdown must be a string.')
  }

  if (Buffer.byteLength(value, 'utf8') > MAX_NOTE_BYTES) {
    throw new Error('Note must be 2 MB or smaller.')
  }

  return value
}

const normalizeNoteName = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('Note name must be a string.')
  }

  const trimmedName = value.trim()
  const nameWithoutExtension =
    extname(trimmedName).toLowerCase() === NOTE_FILE_EXTENSION
      ? trimmedName.slice(0, -extname(trimmedName).length)
      : trimmedName
  const noteId = `${nameWithoutExtension}${NOTE_FILE_EXTENSION}`

  if (
    nameWithoutExtension.length === 0 ||
    nameWithoutExtension === '.' ||
    nameWithoutExtension === '..' ||
    nameWithoutExtension.includes('/') ||
    nameWithoutExtension.includes('\\') ||
    nameWithoutExtension.includes('\0') ||
    Buffer.byteLength(noteId, 'utf8') > MAX_NOTE_FILE_NAME_BYTES
  ) {
    throw new Error('Note name is invalid.')
  }

  return noteId
}

const getIndexedNoteName = (baseName: string, noteNumber: number): string => {
  if (noteNumber === 0) {
    return baseName
  }

  const suffix = ` ${noteNumber}`
  const maximumBaseNameBytes =
    MAX_NOTE_FILE_NAME_BYTES -
    Buffer.byteLength(NOTE_FILE_EXTENSION, 'utf8') -
    Buffer.byteLength(suffix, 'utf8')
  let truncatedBaseName = ''

  for (const character of baseName) {
    if (Buffer.byteLength(`${truncatedBaseName}${character}`, 'utf8') > maximumBaseNameBytes) {
      break
    }

    truncatedBaseName += character
  }

  return `${truncatedBaseName.trimEnd()}${suffix}`
}

const getNotePath = (notesDirectory: string, noteId: string): string => {
  const notePath = join(notesDirectory, noteId)

  if (basename(notePath) !== noteId) {
    throw new Error('Note path is invalid.')
  }

  return notePath
}

const toNoteSummary = async (notesDirectory: string, noteId: string): Promise<NoteSummary> => {
  const notePath = getNotePath(notesDirectory, noteId)
  const noteStats = await lstat(notePath)

  if (!noteStats.isFile()) {
    throw new Error('Note must be a regular Markdown file.')
  }

  const title = noteId.slice(0, -extname(noteId).length)
  const signature = `${noteStats.ino}:${noteStats.size}:${noteStats.mtimeMs}:${noteStats.ctimeMs}`
  const cachedTags = noteTagCache.get(notePath)
  let tags = cachedTags?.signature === signature ? cachedTags.tags : undefined
  if (!tags) {
    tags = noteStats.size <= MAX_NOTE_BYTES
      ? extractNoteTags(withoutNoteProvenance(await readFile(notePath, 'utf8')))
      : []
    if (noteTagCache.size >= MAX_TAG_CACHE_ENTRIES) noteTagCache.clear()
    noteTagCache.set(notePath, { signature, tags })
  }

  return {
    id: noteId,
    title,
    tags,
    createdAt: noteStats.birthtime.toISOString(),
    updatedAt: noteStats.mtime.toISOString()
  }
}

const resolveNotesDirectory = async (notesDirectory?: string): Promise<string> => {
  const resolvedDirectory = notesDirectory ?? (await getConfiguredNoteStorageDirectory())
  await mkdir(resolvedDirectory, { recursive: true })
  return resolvedDirectory
}

const isErrorWithCode = (error: unknown, code: string): boolean => {
  return error instanceof Error && 'code' in error && error.code === code
}

const getNoteNameIdentity = (noteId: string): string => {
  return noteId.normalize('NFC').toLowerCase()
}

const getMarkdownNoteIds = async (notesDirectory: string): Promise<string[]> => {
  const directoryEntries = await readdir(notesDirectory, { withFileTypes: true })

  return directoryEntries
    .filter(
      (entry) =>
        entry.isFile() &&
        extname(entry.name).toLowerCase() === NOTE_FILE_EXTENSION
    )
    .map((entry) => entry.name)
}

const hasConflictingNoteName = (
  noteIds: string[],
  requestedNoteId: string,
  excludedNoteId?: string
): boolean => {
  const requestedIdentity = getNoteNameIdentity(requestedNoteId)

  return noteIds.some(
    (noteId) =>
      noteId !== excludedNoteId &&
      getNoteNameIdentity(noteId) === requestedIdentity
  )
}

const withNoteMutationLock = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  const previousMutation = noteMutationQueue
  let releaseMutation = (): void => undefined

  noteMutationQueue = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })

  await previousMutation

  try {
    return await operation()
  } finally {
    releaseMutation()
  }
}

export const listNotes = async (notesDirectory?: string): Promise<NoteSummary[]> => {
  const resolvedDirectory = await resolveNotesDirectory(notesDirectory)
  const noteIds = await getMarkdownNoteIds(resolvedDirectory)
  const scannedNotes = await Promise.all(noteIds.map(async (noteId) => {
    try {
      return await toNoteSummary(resolvedDirectory, noteId)
    } catch (error) {
      // External editors can remove/replace a file between readdir and lstat.
      if (isErrorWithCode(error, 'ENOENT')) {
        return null
      }
      throw error
    }
  }))
  const notes = scannedNotes.filter((note): note is NoteSummary => note !== null)

  return notes.sort((leftNote, rightNote) =>
    rightNote.updatedAt.localeCompare(leftNote.updatedAt)
  )
}

export const createNote = async (
  notesDirectory?: string,
  initialMarkdownValue: unknown = '',
  preferredNameValue: unknown = DEFAULT_NOTE_NAME
): Promise<NoteDocument> => {
  const initialBody = normalizeMarkdown(initialMarkdownValue)
  const initialMarkdown = normalizeMarkdown(withNoteProvenance(initialBody, {
    version: 1,
    note_id: randomUUID(),
    sources: readNoteProvenance(initialBody)?.sources ?? []
  }))
  const preferredNoteId = normalizeNoteName(preferredNameValue)
  const preferredName = preferredNoteId.slice(0, -NOTE_FILE_EXTENSION.length)

  return withNoteMutationLock(async () => {
    const resolvedDirectory = await resolveNotesDirectory(notesDirectory)
    const existingNoteIds = await getMarkdownNoteIds(resolvedDirectory)

    for (let noteNumber = 0; noteNumber < MAX_DEFAULT_NOTE_NAME_ATTEMPTS; noteNumber += 1) {
      const noteName = getIndexedNoteName(preferredName, noteNumber)
      const noteId = normalizeNoteName(noteName)

      if (hasConflictingNoteName(existingNoteIds, noteId)) {
        continue
      }

      const notePath = getNotePath(resolvedDirectory, noteId)

      try {
        await writeFile(notePath, initialMarkdown, {
          encoding: 'utf8',
          flag: 'wx',
          mode: NOTE_FILE_MODE
        })

        return {
          ...(await toNoteSummary(resolvedDirectory, noteId)),
          markdown: initialMarkdown
        }
      } catch (error) {
        if (!isErrorWithCode(error, 'EEXIST')) {
          throw error
        }
      }
    }

    throw new Error('Unable to find an available default note name.')
  })
}

export const getNote = async (
  noteIdValue: unknown,
  notesDirectory?: string
): Promise<NoteDocument> => {
  const noteId = normalizeNoteId(noteIdValue)
  const resolvedDirectory = await resolveNotesDirectory(notesDirectory)
  const notePath = getNotePath(resolvedDirectory, noteId)
  const noteStats = await lstat(notePath)

  if (!noteStats.isFile()) {
    throw new Error('Note must be a regular Markdown file.')
  }

  if (noteStats.size > MAX_NOTE_BYTES) {
    throw new Error('Note must be 2 MB or smaller.')
  }

  const markdown = await readFile(notePath, 'utf8')
  const backup = await readNoteUpdateBackup(resolvedDirectory, noteId)

  return {
    ...(await toNoteSummary(resolvedDirectory, noteId)),
    markdown,
    ...(backup && backup.after === markdown && backup.before !== markdown
      ? { canUndoUpdate: true }
      : {})
  }
}

export const saveNote = async (
  request: unknown,
  notesDirectory?: string
): Promise<NoteDocument> => withNoteMutationLock(async () => {
  assertRecord(request)

  const noteId = normalizeNoteId(request.id)
  const restoring = request.restorePrevious === true
  const preserving = request.preservePrevious === true
  let markdown = restoring ? '' : normalizeMarkdown(request.markdown)
  const expectedMarkdown = request.expectedMarkdown === undefined
    ? undefined : normalizeMarkdown(request.expectedMarkdown)
  if ((restoring || preserving) && (expectedMarkdown === undefined ||
    typeof request.expectedDirectory !== 'string' || !request.expectedDirectory)) {
    throw new Error('更新或撤销笔记需要原内容和存储目录，请重新打开笔记。')
  }
  const resolvedDirectory = await resolveNotesDirectory(notesDirectory)
  if (request.expectedDirectory !== undefined &&
    (typeof request.expectedDirectory !== 'string' ||
      resolve(request.expectedDirectory) !== resolve(resolvedDirectory))) {
    throw new Error('笔记目录已变更，请重新生成预览。')
  }
  const notePath = getNotePath(resolvedDirectory, noteId)
  const temporaryPath = join(resolvedDirectory, `.${randomUUID()}.tmp`)
  const noteStats = await lstat(notePath)

  if (!noteStats.isFile()) {
    throw new Error('Note must be a regular Markdown file.')
  }

  const currentNote = await getNote(noteId, resolvedDirectory)
  if (expectedMarkdown !== undefined && currentNote.markdown !== expectedMarkdown) {
    throw new Error('笔记内容已变更，本次操作未保存。请重新生成预览或打开最新笔记。')
  }
  if (restoring) {
    const backup = await readNoteUpdateBackup(resolvedDirectory, noteId)
    if (!backup || backup.after !== currentNote.markdown || backup.before === backup.after) {
      throw new Error('没有可撤销的更新，或笔记在更新后已被编辑。')
    }
    markdown = normalizeMarkdown(backup.before)
  }
  const currentMetadata = readNoteProvenance(currentNote.markdown)
  const proposedMetadata = readNoteProvenance(markdown)
  markdown = normalizeMarkdown(withNoteProvenance(markdown, {
    version: 1,
    note_id: currentMetadata?.note_id ?? proposedMetadata?.note_id ?? randomUUID(),
    sources: restoring
      ? proposedMetadata?.sources ?? []
      : mergeNoteSources(currentMetadata?.sources ?? [], proposedMetadata?.sources ?? [])
  }))
  if (markdown === currentNote.markdown) {
    return currentNote
  }
  if (preserving) {
    await writeNoteUpdateBackup(resolvedDirectory, noteId, {
      before: currentNote.markdown,
      after: markdown
    })
  }

  try {
    await writeFile(temporaryPath, markdown, {
      encoding: 'utf8',
      flag: 'wx',
      mode: noteStats.mode & 0o777
    })
    // External editors do not participate in the app's mutation queue.
    if (expectedMarkdown !== undefined && await readFile(notePath, 'utf8') !== expectedMarkdown) {
      throw new Error('笔记内容已变更，本次操作未保存。请重新生成预览。')
    }
    await rename(temporaryPath, notePath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }

  return getNote(noteId, resolvedDirectory)
})

export const renameNote = async (
  request: unknown,
  notesDirectory?: string
): Promise<NoteDocument> => {
  return withNoteMutationLock(async () => {
    assertRecord(request)

    const currentNoteId = normalizeNoteId(request.id)
    const nextNoteId = normalizeNoteName(request.name)
    const resolvedDirectory = await resolveNotesDirectory(notesDirectory)
    const currentNotePath = getNotePath(resolvedDirectory, currentNoteId)
    const nextNotePath = getNotePath(resolvedDirectory, nextNoteId)
    const currentNoteStats = await lstat(currentNotePath)

    if (!currentNoteStats.isFile()) {
      throw new Error('Note must be a regular Markdown file.')
    }

    if (currentNotePath === nextNotePath) {
      return getNote(currentNoteId, resolvedDirectory)
    }

    const existingNoteIds = await getMarkdownNoteIds(resolvedDirectory)

    if (hasConflictingNoteName(existingNoteIds, nextNoteId, currentNoteId)) {
      throw new Error(
        `A note named "${nextNoteId.slice(0, -NOTE_FILE_EXTENSION.length)}" already exists.`
      )
    }

    try {
      const nextNoteStats = await lstat(nextNotePath)
      const isSameFile =
        currentNoteStats.dev === nextNoteStats.dev && currentNoteStats.ino === nextNoteStats.ino

      if (!isSameFile) {
        throw new Error(
          `A note named "${nextNoteId.slice(0, -NOTE_FILE_EXTENSION.length)}" already exists.`
        )
      }
    } catch (error) {
      if (!isErrorWithCode(error, 'ENOENT')) {
        throw error
      }
    }

    await rename(currentNotePath, nextNotePath)
    return getNote(nextNoteId, resolvedDirectory)
  })
}

export const trashNote = async (
  noteIdValue: unknown,
  trashItem: (notePath: string) => Promise<void>,
  notesDirectory?: string
): Promise<DeleteNoteResponse> => {
  return withNoteMutationLock(async () => {
    const noteId = normalizeNoteId(noteIdValue)
    const resolvedDirectory = await resolveNotesDirectory(notesDirectory)
    const notePath = getNotePath(resolvedDirectory, noteId)
    const noteStats = await lstat(notePath)

    if (!noteStats.isFile()) {
      throw new Error('Note must be a regular Markdown file.')
    }

    await trashItem(notePath)
    return { id: noteId, deleted: true }
  })
}
