import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const mainSourcePath = fileURLToPath(new URL('./index.ts', import.meta.url))
const preloadSourcePath = fileURLToPath(new URL('../preload/index.ts', import.meta.url))
const rendererTypesPath = fileURLToPath(
  new URL('../renderer/src/env.d.ts', import.meta.url)
)
const sharedTypesPath = fileURLToPath(new URL('../shared/ai.ts', import.meta.url))

describe('pronunciation audio IPC', () => {
  it('exposes a typed request from the renderer to the cached main-process service', async () => {
    const [mainSource, preloadSource, rendererTypes, sharedTypes] = await Promise.all([
      readFile(mainSourcePath, 'utf8'),
      readFile(preloadSourcePath, 'utf8'),
      readFile(rendererTypesPath, 'utf8'),
      readFile(sharedTypesPath, 'utf8')
    ])

    expect(sharedTypes).toContain(
      "GET_PRONUNCIATION_AUDIO_CHANNEL = 'english-ask:get-pronunciation-audio'"
    )
    expect(mainSource).toContain('new PronunciationAudioService(')
    expect(mainSource).toContain('PRONUNCIATION_CACHE_DIRECTORY_NAME')
    expect(mainSource).toContain('ipcMain.handle(\n  GET_PRONUNCIATION_AUDIO_CHANNEL,')
    expect(preloadSource).toContain('getPronunciationAudio: (')
    expect(preloadSource).toContain(
      'ipcRenderer.invoke(GET_PRONUNCIATION_AUDIO_CHANNEL, request)'
    )
    expect(rendererTypes).toContain('getPronunciationAudio: (')
  })
})
