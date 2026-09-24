import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

it('does not display a waiting cursor for disabled controls', () => {
  expect(styles).not.toMatch(/cursor:\s*(?:wait|progress)\b/)
  for (const selector of [
    '.historyItem:disabled',
    '.askNoteToolbar button:disabled',
    '.settingsForm button:disabled',
    '.settingsForm .refreshModelsButton:disabled'
  ]) {
    const declaration = styles.slice(styles.indexOf(selector)).split('}')[0]
    expect(declaration).toContain('cursor: default;')
  }
})
