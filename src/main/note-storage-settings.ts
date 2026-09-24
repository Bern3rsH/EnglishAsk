import { dialog } from 'electron'
import type { NoteStorageSettingsResult } from '../shared/ai'
import {
  getConfiguredNoteStorageDirectory,
  getSettingsState,
  resetConfiguredNoteStorageDirectory,
  setConfiguredNoteStorageDirectory
} from './settings'

export const chooseNoteStorageDirectory = async (): Promise<NoteStorageSettingsResult> => {
  const selection = await dialog.showOpenDialog({
    title: '选择 Notes 存储目录',
    buttonLabel: '选择目录',
    defaultPath: await getConfiguredNoteStorageDirectory(),
    properties: ['openDirectory', 'createDirectory']
  })

  if (selection.canceled || !selection.filePaths[0]) {
    return {
      ok: true,
      data: {
        changed: false,
        settings: await getSettingsState()
      }
    }
  }

  return {
    ok: true,
    data: {
      changed: true,
      settings: await setConfiguredNoteStorageDirectory(selection.filePaths[0])
    }
  }
}

export const useDefaultNoteStorageDirectory = async (): Promise<NoteStorageSettingsResult> => {
  return {
    ok: true,
    data: {
      changed: true,
      settings: await resetConfiguredNoteStorageDirectory()
    }
  }
}
