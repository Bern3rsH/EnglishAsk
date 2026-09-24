import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appSourcePath = fileURLToPath(new URL('./App.tsx', import.meta.url))

describe('model settings refresh UI', () => {
  it('leaves the API key input without a placeholder', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')
    const input = appSource.match(/<input\s+aria-label=\{`\$\{selectedProviderLabel\} API 密钥`\}[\s\S]*?\/>/)?.[0]
    expect(input).toBeDefined()
    expect(input).not.toContain('placeholder=')
  })

  it('renders the refresh action only for providers with dynamic model listing', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain(
      'supportsDynamicModelListing(selectedModelProvider)'
    )
    expect(appSource).toContain('canRefreshSelectedProviderModels ? (')
    expect(appSource).toContain('aria-label="刷新模型列表"')
    expect(appSource).toContain('englishAskBridge.listProviderModels({')
    expect(appSource).toContain('modelProvider: selectedModelProvider')
    expect(appSource).toContain('...(apiKey ? { apiKey } : {})')
    expect(appSource).toContain(
      '`${selectedModelName} 已不可用，请选择其他模型。`'
    )
    expect(appSource).toContain('{selectedModelName}（不可用）')
    expect(appSource).toContain(
      '(shouldShowModelNames && !isSelectedModelAvailable)'
    )
    expect(appSource).not.toContain(
      "selectedModelProvider !== 'google-gemini'"
    )
  })
})
