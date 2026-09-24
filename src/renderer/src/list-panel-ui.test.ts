import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appSourcePath = fileURLToPath(new URL('./App.tsx', import.meta.url))

describe('Asks and Notes 列表-panel behavior', () => {
  it('persists an independent constrained width for each list', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain(
      "const ASKS_LIST_WIDTH_STORAGE_KEY = 'english-ask:asks-list-width'"
    )
    expect(appSource).toContain(
      "const NOTES_LIST_WIDTH_STORAGE_KEY = 'english-ask:notes-list-width'"
    )
    expect(appSource).toMatch(
      /loadInitialListPanelWidth\(ASKS_LIST_WIDTH_STORAGE_KEY,\s*'Asks'\)/
    )
    expect(appSource).toMatch(
      /loadInitialListPanelWidth\(NOTES_LIST_WIDTH_STORAGE_KEY,\s*'Notes'\)/
    )
    expect(appSource).toMatch(
      /'--list-panel-width':\s*`\$\{\s*activeWorkspace === 'asks' \? asksListWidth : notesListWidth\s*\}px`/s
    )
  })

  it('renders matching pointer and keyboard resize separators', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain('aria-label="调整 Asks 列表宽度"')
    expect(appSource).toContain('aria-label="调整 Notes 列表宽度"')
    expect(appSource).toMatch(
      /onKeyDown=\{\(event\) => handleListPanelResizeKeyDown\('asks', event\)\}/
    )
    expect(appSource).toMatch(
      /onKeyDown=\{\(event\) => handleListPanelResizeKeyDown\('notes', event\)\}/
    )
    expect(appSource.match(/role="separator"/g)).toHaveLength(2)
  })
})
