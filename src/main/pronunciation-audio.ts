import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import type {
  PronunciationAudioRequest,
  PronunciationAudioResponse
} from '../shared/ai'

export const PRONUNCIATION_AUDIO_MIME_TYPE = 'audio/mpeg'
export const PRONUNCIATION_EDGE_VOICE = 'en-US-JennyNeural'
export const MAX_PRONUNCIATION_TEXT_LENGTH = 1_000

export const PRONUNCIATION_AUDIO_TIMEOUT_MS = 15_000
const INVALID_XML_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u

type PronunciationAudioGenerator = (text: string, outputPath: string) => Promise<void>

const isMissingFileError = (error: unknown): boolean => {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

const removeFileIfPresent = async (filePath: string): Promise<void> => {
  try {
    await unlink(filePath)
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }
}

export const escapePronunciationSsmlText = (text: string): string => {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export const validatePronunciationAudioRequest = (
  request: unknown
): PronunciationAudioRequest => {
  if (typeof request !== 'object' || request === null || !('text' in request)) {
    throw new Error('Pronunciation request must include text.')
  }

  if (typeof request.text !== 'string') {
    throw new Error('Pronunciation text must be a string.')
  }

  const text = request.text.trim().replace(/\s+/gu, ' ')

  if (text.length === 0) {
    throw new Error('Pronunciation text cannot be empty.')
  }

  if (text.length > MAX_PRONUNCIATION_TEXT_LENGTH) {
    throw new Error(
      `Pronunciation text must be ${MAX_PRONUNCIATION_TEXT_LENGTH} characters or fewer.`
    )
  }

  if (INVALID_XML_CHARACTER_PATTERN.test(text)) {
    throw new Error('Pronunciation text contains unsupported control characters.')
  }

  return { text }
}

export const generateEdgePronunciationAudio: PronunciationAudioGenerator = async (
  text,
  outputPath
): Promise<void> => {
  const tts = new MsEdgeTTS()
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error('Pronunciation audio generation timed out.')
      controller.abort(error)
      reject(error)
    }, PRONUNCIATION_AUDIO_TIMEOUT_MS)
  })

  const generateAudio = async (): Promise<void> => {
    await tts.setMetadata(
      PRONUNCIATION_EDGE_VOICE,
      OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
      { voiceLocale: 'en-US' }
    )

    // A late connection must not start playback work after the timeout has won.
    if (controller.signal.aborted) {
      tts.close()
      throw controller.signal.reason
    }

    const { audioStream } = tts.toStream(escapePronunciationSsmlText(text))

    await pipeline(audioStream, createWriteStream(outputPath, { mode: 0o600 }), {
      signal: controller.signal
    })
  }

  try {
    await Promise.race([generateAudio(), timeout])
  } catch (error) {
    if (controller.signal.aborted) {
      throw controller.signal.reason
    }

    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    clearTimeout(timeoutId)
    tts.close()
  }
}

export class PronunciationAudioService {
  private readonly pendingAudio = new Map<string, Promise<PronunciationAudioResponse>>()

  constructor(
    private readonly cacheDirectory: string,
    private readonly generateAudio: PronunciationAudioGenerator =
      generateEdgePronunciationAudio
  ) {}

  async getAudio(request: unknown): Promise<PronunciationAudioResponse> {
    const { text } = validatePronunciationAudioRequest(request)
    const cacheKey = createHash('sha256')
      .update(`${PRONUNCIATION_EDGE_VOICE}\0${text}`)
      .digest('hex')
    const cachePath = join(this.cacheDirectory, `${cacheKey}.mp3`)
    const cachedAudio = await this.readCachedAudio(cachePath)

    if (cachedAudio) {
      return this.createResponse(cachedAudio)
    }

    const pendingAudio = this.pendingAudio.get(cacheKey)

    if (pendingAudio) {
      return pendingAudio
    }

    const generation = this.generateAndCacheAudio(text, cachePath).finally(() => {
      this.pendingAudio.delete(cacheKey)
    })

    this.pendingAudio.set(cacheKey, generation)
    return generation
  }

  private async generateAndCacheAudio(
    text: string,
    cachePath: string
  ): Promise<PronunciationAudioResponse> {
    await mkdir(this.cacheDirectory, { mode: 0o700, recursive: true })

    const temporaryPath = `${cachePath}.${randomUUID()}.tmp`

    try {
      await this.generateAudio(text, temporaryPath)

      const temporaryFile = await stat(temporaryPath)

      if (!temporaryFile.isFile() || temporaryFile.size === 0) {
        throw new Error('Pronunciation service returned empty audio.')
      }

      await rename(temporaryPath, cachePath)
      return this.createResponse(await readFile(cachePath))
    } finally {
      await removeFileIfPresent(temporaryPath)
    }
  }

  private async readCachedAudio(cachePath: string): Promise<Buffer | null> {
    try {
      const cacheFile = await stat(cachePath)

      if (!cacheFile.isFile() || cacheFile.size === 0) {
        await removeFileIfPresent(cachePath)
        return null
      }

      return readFile(cachePath)
    } catch (error) {
      if (isMissingFileError(error)) {
        return null
      }

      throw error
    }
  }

  private createResponse(audio: Buffer): PronunciationAudioResponse {
    return {
      data: audio.toString('base64'),
      mimeType: PRONUNCIATION_AUDIO_MIME_TYPE
    }
  }
}
