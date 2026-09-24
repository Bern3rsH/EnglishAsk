import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { MsEdgeTTS } from 'msedge-tts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  escapePronunciationSsmlText,
  generateEdgePronunciationAudio,
  MAX_PRONUNCIATION_TEXT_LENGTH,
  PRONUNCIATION_AUDIO_MIME_TYPE,
  PRONUNCIATION_AUDIO_TIMEOUT_MS,
  PronunciationAudioService,
  validatePronunciationAudioRequest
} from './pronunciation-audio'

describe('pronunciation audio service', () => {
  let cacheDirectory: string
  let temporaryDirectory: string

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'english-ask-pronunciation-'))
    cacheDirectory = join(temporaryDirectory, 'cache')
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await rm(temporaryDirectory, { force: true, recursive: true })
  })

  it('normalizes and validates pronunciation requests', () => {
    expect(validatePronunciationAudioRequest({ text: '  cold   turkey  ' })).toEqual({
      text: 'cold turkey'
    })
    expect(() => validatePronunciationAudioRequest(null)).toThrow(
      'Pronunciation request must include text.'
    )
    expect(() => validatePronunciationAudioRequest({ text: '   ' })).toThrow(
      'Pronunciation text cannot be empty.'
    )
    expect(() =>
      validatePronunciationAudioRequest({
        text: 'a'.repeat(MAX_PRONUNCIATION_TEXT_LENGTH + 1)
      })
    ).toThrow(`Pronunciation text must be ${MAX_PRONUNCIATION_TEXT_LENGTH} characters or fewer.`)
    expect(() => validatePronunciationAudioRequest({ text: 'bad\u0000text' })).toThrow(
      'Pronunciation text contains unsupported control characters.'
    )
  })

  it('escapes user text before inserting it into SSML', () => {
    expect(escapePronunciationSsmlText(`Tom & Sue's <example> "quote"`)).toBe(
      'Tom &amp; Sue&apos;s &lt;example&gt; &quot;quote&quot;'
    )
  })

  it('generates an MP3 once and reuses its disk cache', async () => {
    const generateAudio = vi.fn(async (text: string, outputPath: string) => {
      await writeFile(outputPath, Buffer.from(`audio:${text}`))
    })
    const service = new PronunciationAudioService(cacheDirectory, generateAudio)
    const firstResult = await service.getAudio({ text: 'cold turkey' })
    const secondService = new PronunciationAudioService(
      cacheDirectory,
      vi.fn(async () => {
        throw new Error('Cache miss')
      })
    )
    const cachedResult = await secondService.getAudio({ text: 'cold turkey' })

    expect(generateAudio).toHaveBeenCalledOnce()
    expect(firstResult).toEqual(cachedResult)
    expect(firstResult.mimeType).toBe(PRONUNCIATION_AUDIO_MIME_TYPE)
    expect(Buffer.from(firstResult.data, 'base64').toString()).toBe('audio:cold turkey')
  })

  it('deduplicates simultaneous requests for the same target', async () => {
    const generateAudio = vi.fn(async (text: string, outputPath: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      await writeFile(outputPath, Buffer.from(`audio:${text}`))
    })
    const service = new PronunciationAudioService(cacheDirectory, generateAudio)

    const [firstResult, secondResult] = await Promise.all([
      service.getAudio({ text: 'carnage' }),
      service.getAudio({ text: 'carnage' })
    ])

    expect(generateAudio).toHaveBeenCalledOnce()
    expect(firstResult).toEqual(secondResult)
  })

  it('rejects empty generated audio without caching it', async () => {
    const generateAudio = vi.fn(async (_text: string, outputPath: string) => {
      await writeFile(outputPath, Buffer.alloc(0))
    })
    const service = new PronunciationAudioService(cacheDirectory, generateAudio)

    await expect(service.getAudio({ text: 'carnage' })).rejects.toThrow(
      'Pronunciation service returned empty audio.'
    )
    await expect(service.getAudio({ text: 'carnage' })).rejects.toThrow(
      'Pronunciation service returned empty audio.'
    )
    expect(generateAudio).toHaveBeenCalledTimes(2)
  })

  it('removes partial files and allows retry after a generation failure', async () => {
    const generateAudio = vi.fn(async (_text: string, outputPath: string) => {
      await writeFile(outputPath, Buffer.from('audio'))

      if (generateAudio.mock.calls.length === 1) {
        throw new Error('Connection lost')
      }
    })
    const service = new PronunciationAudioService(cacheDirectory, generateAudio)

    await expect(service.getAudio({ text: 'retry' })).rejects.toThrow('Connection lost')
    expect(await readdir(cacheDirectory)).toEqual([])
    await expect(service.getAudio({ text: 'retry' })).resolves.toMatchObject({
      mimeType: 'audio/mpeg'
    })
    expect(generateAudio).toHaveBeenCalledTimes(2)
  })

  it('times out a stalled connection and ignores its late completion', async () => {
    vi.useFakeTimers()
    let resolveMetadata!: () => void
    vi.spyOn(MsEdgeTTS.prototype, 'setMetadata').mockImplementation(
      () => new Promise<void>((resolve) => { resolveMetadata = resolve })
    )
    const close = vi.spyOn(MsEdgeTTS.prototype, 'close').mockImplementation(() => {})
    const toStream = vi.spyOn(MsEdgeTTS.prototype, 'toStream')
    const generation = generateEdgePronunciationAudio(
      'test',
      join(temporaryDirectory, 'timeout.mp3')
    )
    const assertion = expect(generation).rejects.toThrow('generation timed out')

    await vi.advanceTimersByTimeAsync(PRONUNCIATION_AUDIO_TIMEOUT_MS)
    await assertion
    expect(close).toHaveBeenCalledOnce()
    resolveMetadata()
    await Promise.resolve()
    expect(toStream).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('aborts the audio stream when downloading times out', async () => {
    vi.useFakeTimers()
    const audioStream = new Readable({ read() {} })
    vi.spyOn(MsEdgeTTS.prototype, 'setMetadata').mockResolvedValue(undefined)
    vi.spyOn(MsEdgeTTS.prototype, 'toStream').mockReturnValue({
      audioStream,
      metadataStream: null
    })
    vi.spyOn(MsEdgeTTS.prototype, 'close').mockImplementation(() => {})
    const generation = generateEdgePronunciationAudio(
      'test',
      join(temporaryDirectory, 'stream-timeout.mp3')
    )
    const assertion = expect(generation).rejects.toThrow('generation timed out')

    await vi.advanceTimersByTimeAsync(PRONUNCIATION_AUDIO_TIMEOUT_MS)
    await assertion
    expect(audioStream.destroyed).toBe(true)
  })
})
