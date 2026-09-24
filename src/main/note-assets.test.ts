import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import { saveNoteImage } from './note-assets'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn()
  }
}))

describe('note assets', () => {
  let assetsDirectory: string

  beforeEach(async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'english-ask-note-assets-'))
    assetsDirectory = join(userDataDirectory, 'notes', 'note-assets')
    vi.mocked(app.getPath).mockReturnValue(userDataDirectory)
  })

  it('saves supported image data and returns a file URL', async () => {
    const imageBytes = new Uint8Array([137, 80, 78, 71])

    const result = await saveNoteImage({
      fileName: 'screen shot.png',
      mimeType: 'image/png',
      data: imageBytes.buffer
    })

    const savedPath = fileURLToPath(result.url)

    expect(savedPath.startsWith(assetsDirectory)).toBe(true)
    expect(result.fileName).toBe('screen shot.png')
    expect(result.size).toBe(imageBytes.byteLength)
    await expect(readFile(savedPath)).resolves.toEqual(Buffer.from(imageBytes))
  })

  it('rejects unsupported image types', async () => {
    await expect(
      saveNoteImage({
        fileName: 'vector.svg',
        mimeType: 'image/svg+xml',
        data: new Uint8Array([1]).buffer
      })
    ).rejects.toThrow('Only PNG, JPEG, GIF, and WebP images are supported.')
  })

  it('rejects images over 10 MB', async () => {
    await expect(
      saveNoteImage({
        fileName: 'large.png',
        mimeType: 'image/png',
        data: new Uint8Array(10 * 1024 * 1024 + 1).buffer
      })
    ).rejects.toThrow('Image must be 10 MB or smaller.')
  })
})
