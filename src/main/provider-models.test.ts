import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listDeepSeekModels } from './deepseek-models'
import { listGeminiModels } from './gemini-models'
import { listProviderModels } from './provider-models'
import { listOpenAICompatibleModels } from './openai-compatible-models'
import { listNativeProviderModels } from './native-provider-models'

vi.mock('./openai-compatible-models', () => ({ listOpenAICompatibleModels: vi.fn() }))
vi.mock('./native-provider-models', () => ({ listNativeProviderModels: vi.fn() }))

vi.mock('./deepseek-models', () => ({
  listDeepSeekModels: vi.fn()
}))

vi.mock('./gemini-models', () => ({
  listGeminiModels: vi.fn()
}))

describe('provider model listing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes DeepSeek requests with an unsaved API key', async () => {
    vi.mocked(listDeepSeekModels).mockResolvedValue(['deepseek-v4-flash'])

    await expect(
      listProviderModels({
        modelProvider: 'deepseek',
        apiKey: '  deepseek-key  '
      })
    ).resolves.toEqual(['deepseek-v4-flash'])

    expect(listDeepSeekModels).toHaveBeenCalledWith('deepseek-key')
    expect(listGeminiModels).not.toHaveBeenCalled()
  })

  it('routes Gemini requests through the same provider-neutral contract', async () => {
    vi.mocked(listGeminiModels).mockResolvedValue(['gemini-2.5-flash'])

    await expect(
      listProviderModels({
        modelProvider: 'google-gemini'
      })
    ).resolves.toEqual(['gemini-2.5-flash'])

    expect(listGeminiModels).toHaveBeenCalledWith(undefined)
    expect(listDeepSeekModels).not.toHaveBeenCalled()
  })

  it.each(['openai', 'openrouter'] as const)('routes %s through its authenticated model list', async provider => {
    vi.mocked(listOpenAICompatibleModels).mockResolvedValue(['test-model'])
    await expect(listProviderModels({ modelProvider: provider, apiKey: '  test-key  ' })).resolves.toEqual(['test-model'])
    expect(listOpenAICompatibleModels).toHaveBeenCalledWith(provider, 'test-key')
    expect(listGeminiModels).not.toHaveBeenCalled()
    expect(listDeepSeekModels).not.toHaveBeenCalled()
  })

  it.each(['anthropic'] as const)('routes %s to its native paginated list', async provider => {
    vi.mocked(listNativeProviderModels).mockResolvedValue(['test-model'])
    await expect(listProviderModels({ modelProvider: provider, apiKey: '  test-key  ' })).resolves.toEqual(['test-model'])
    expect(listNativeProviderModels).toHaveBeenCalledWith(provider, 'test-key')
    expect(listGeminiModels).not.toHaveBeenCalled()
  })

  it('rejects unknown providers and malformed API keys', async () => {
    await expect(listProviderModels({ modelProvider: 'bailian' })).rejects.toThrow('not supported')
    await expect(
      listProviderModels({ modelProvider: 'unknown' })
    ).rejects.toThrow('Model provider is not supported')

    await expect(
      listProviderModels({ modelProvider: 'deepseek', apiKey: 42 })
    ).rejects.toThrow('API key must be a string')
  })
})
