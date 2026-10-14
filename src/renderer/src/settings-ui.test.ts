import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appSourcePath = fileURLToPath(new URL('./App.tsx', import.meta.url))

describe('settings model synchronization', () => {
  it('uses a larger checkbox for the note timestamp setting', async () => {
    const source = await readFile(appSourcePath, 'utf8')
    const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8')
    expect(source).toContain('className="noteTimestampCheckbox" type="checkbox"')
    const rule = styles.match(/\.settingsCheckbox \.noteTimestampCheckbox \{([^}]+)\}/)?.[1]
    expect(rule).toContain('width: 20px;')
    expect(rule).toContain('height: 20px;')
    expect(rule).toContain('flex-shrink: 0;')
  })
  it('offers an immediately persisted timestamp switch in Notes settings', async () => {
    const source = await readFile(appSourcePath, 'utf8')
    const notesSettings = source.slice(source.indexOf('const storageSettingsContent'), source.indexOf('const askListPanel'))
    expect(notesSettings).toContain('aria-label="标题添加时间戳"')
    expect(notesSettings).toContain('checked={settings?.noteTitleTimestampEnabled ?? false}')
    expect(notesSettings).toContain('noteTitleTimestampEnabled: enabled')
    expect(notesSettings).toContain('setSettings(result.data)')
    const mainSource = await readFile(new URL('../../main/index.ts', import.meta.url), 'utf8')
    expect(mainSource).toContain('(await getSettingsState()).noteTitleTimestampEnabled ?? false')
  })
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
