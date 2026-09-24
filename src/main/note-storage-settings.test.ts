import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app, dialog } from 'electron'
import {
  chooseNoteStorageDirectory,
  useDefaultNoteStorageDirectory
} from './note-storage-settings'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn()
  },
  dialog: {
    showOpenDialog: vi.fn()
  }
}))

describe('note storage directory dialog', () => {
  let userDataDirectory: string

  beforeEach(async () => {
    userDataDirectory = await mkdtemp(join(tmpdir(), 'english-ask-note-settings-'))
    vi.mocked(app.getPath).mockReturnValue(userDataDirectory)
  })

  it('keeps the current directory when folder selection is canceled', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: true,
      filePaths: []
    })

    await expect(chooseNoteStorageDirectory()).resolves.toMatchObject({
      ok: true,
      data: {
        changed: false,
        settings: {
          noteStorageDirectory: join(userDataDirectory, 'notes'),
          noteStorageSource: 'default'
        }
      }
    })
  })

  it('stores a selected local directory and can restore the app default', async () => {
    const customDirectory = await mkdtemp(join(tmpdir(), 'english-ask-selected-notes-'))
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: [customDirectory]
    })

    await expect(chooseNoteStorageDirectory()).resolves.toMatchObject({
      ok: true,
      data: {
        changed: true,
        settings: {
          noteStorageDirectory: customDirectory,
          noteStorageSource: 'custom'
        }
      }
    })
    await expect(useDefaultNoteStorageDirectory()).resolves.toMatchObject({
      ok: true,
      data: {
        settings: {
          noteStorageDirectory: join(userDataDirectory, 'notes'),
          noteStorageSource: 'default'
        }
      }
    })
  })
})
