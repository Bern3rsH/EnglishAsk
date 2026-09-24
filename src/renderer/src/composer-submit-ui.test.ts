import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appSourcePath = fileURLToPath(new URL('./App.tsx', import.meta.url))

describe('Ask composer submission UI', () => {
  it('disables 发送 and silently ignores an empty question', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain('disabled={!englishAskBridge || isSavingSettings || question.trim().length === 0}')
    expect(appSource).toContain('if (isSavingSettings) return')
    expect(appSource).toContain("if (normalizedQuestion.length === 0) {\n      return")
    expect(appSource).not.toContain('Enter a question first.')
  })
})
