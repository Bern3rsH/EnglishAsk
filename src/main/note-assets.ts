import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SaveNoteImageResponse } from '../shared/ai'
import { getConfiguredNoteStorageDirectory } from './settings'

const NOTE_ASSETS_DIRECTORY_NAME = 'note-assets'
const MAX_NOTE_IMAGE_BYTES = 10 * 1024 * 1024
const IMAGE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
}

const assertRecord = (value: unknown): asserts value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Image save request must be an object.')
  }
}

const normalizeImageMimeType = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('Image MIME type must be a string.')
  }

  const mimeType = value.trim().toLowerCase()

  if (!IMAGE_EXTENSION_BY_MIME_TYPE[mimeType]) {
    throw new Error('Only PNG, JPEG, GIF, and WebP images are supported.')
  }

  return mimeType
}

const normalizeImageData = (value: unknown): Buffer => {
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value)
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }

  throw new Error('Image data must be binary.')
}

const normalizeOriginalFileName = (value: unknown): string => {
  if (typeof value !== 'string') {
    return 'image'
  }

  const fileName = value.trim().replace(/[/\\]/g, '-')

  return fileName.length > 0 ? fileName : 'image'
}

const getNoteAssetsDirectory = async (): Promise<string> => {
  return join(await getConfiguredNoteStorageDirectory(), NOTE_ASSETS_DIRECTORY_NAME)
}

export const saveNoteImage = async (
  request: unknown,
  assetsDirectory?: string
): Promise<SaveNoteImageResponse> => {
  assertRecord(request)

  const mimeType = normalizeImageMimeType(request.mimeType)
  const imageData = normalizeImageData(request.data)

  if (imageData.length === 0) {
    throw new Error('Image cannot be empty.')
  }

  if (imageData.length > MAX_NOTE_IMAGE_BYTES) {
    throw new Error('Image must be 10 MB or smaller.')
  }

  const originalFileName = normalizeOriginalFileName(request.fileName)
  const extension = IMAGE_EXTENSION_BY_MIME_TYPE[mimeType]
  const storedFileName = `${randomUUID()}${extension}`
  const resolvedAssetsDirectory = assetsDirectory ?? (await getNoteAssetsDirectory())
  const imagePath = join(resolvedAssetsDirectory, storedFileName)

  await mkdir(resolvedAssetsDirectory, { recursive: true })
  await writeFile(imagePath, imageData, { mode: 0o600 })

  return {
    fileName: originalFileName,
    size: imageData.length,
    url: pathToFileURL(imagePath).toString()
  }
}
