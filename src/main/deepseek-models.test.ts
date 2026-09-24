import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractAvailableDeepSeekModels,
  listDeepSeekModelsWithApiKey
} from './deepseek-models'

const createFetchResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }) as Response

describe('DeepSeek model listing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('extracts unique text model ids', () => {
    expect(
      extractAvailableDeepSeekModels({
        data: [
          { id: 'deepseek-v4-pro' },
          { id: 'deepseek-v4-flash' },
          { id: 'deepseek-v4-flash' },
          { id: 'deepseek-embedding' },
          { id: '   ' },
          {}
        ]
      })
    ).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
  })

  it('loads models from the official endpoint with bearer authentication', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createFetchResponse({
        object: 'list',
        data: [
          { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek' },
          { id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' }
        ]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(listDeepSeekModelsWithApiKey('deepseek-key')).resolves.toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro'
    ])
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/models', {
      headers: {
        Authorization: 'Bearer deepseek-key'
      }
    })
  })

  it('includes official API error messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createFetchResponse(
          {
            error: {
              message: 'Authentication Fails'
            }
          },
          401
        )
      )
    )

    await expect(listDeepSeekModelsWithApiKey('invalid-key')).rejects.toThrow(
      'Unable to load DeepSeek models (401): Authentication Fails'
    )
  })

  it('rejects malformed successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createFetchResponse({ object: 'list' })))

    await expect(listDeepSeekModelsWithApiKey('deepseek-key')).rejects.toThrow(
      'DeepSeek model list response is invalid.'
    )
  })
})
