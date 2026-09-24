import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appSourcePath = fileURLToPath(new URL('./App.tsx', import.meta.url))

describe('settings model synchronization', () => {
  it('clears the previous response model after saving updated model settings', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')
    const settingsSubmitHandler = appSource.slice(
      appSource.indexOf('const handleSettingsSubmit'),
      appSource.indexOf('const chooseNotesDirectory')
    )

    expect(settingsSubmitHandler).toMatch(
      /if \(result\.ok\) \{\s*setSettings\(result\.data\)\s*setModelName\(null\)/s
    )
  })

  it('removes language selection and saves the fixed answer-language default', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')
    expect(appSource).not.toContain('handleDefaultAnswerLanguageChange')
    expect(appSource).not.toContain('Default answer language')
    expect(appSource).not.toContain('languageSettingsContent')
    expect(appSource).toContain('defaultAnswerLanguage: DEFAULT_ANSWER_LANGUAGE')
  })
})
