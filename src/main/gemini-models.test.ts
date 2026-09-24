import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractGenerativeGeminiModels, listGeminiModelsWithApiKey } from './gemini-models'

const createFetchResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }) as Response

describe('extractGenerativeGeminiModels', () => {
  it('extracts unique generateContent model ids from Gemini list responses', () => {
    expect(
      extractGenerativeGeminiModels({
        models: [
          {
            name: 'models/gemini-2.5-flash',
            supportedGenerationMethods: ['generateContent', 'countTokens']
          },
          {
            name: 'models/text-embedding-004',
            supportedGenerationMethods: ['embedContent']
          },
          {
            name: 'models/gemini-2.5-flash',
            supportedGenerationMethods: ['generateContent']
          },
          {
            name: 'models/gemini-2.5-pro',
            supportedGenerationMethods: ['generateContent']
          }
        ]
      })
    ).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro'])
  })
})

describe('listGeminiModelsWithApiKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads all paginated Gemini model list responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          models: [
            {
              name: 'models/gemini-2.5-flash',
              supportedGenerationMethods: ['generateContent']
            },
            {
              name: 'models/gemini-3-pro-image',
              supportedGenerationMethods: ['generateContent']
            }
          ],
          nextPageToken: 'second-page'
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          models: [
            {
              name: 'models/gemini-2.5-pro',
              supportedGenerationMethods: ['generateContent']
            },
            {
              name: 'models/gemini-3.1-flash-tts-preview',
              supportedGenerationMethods: ['generateContent']
            }
          ]
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    await expect(listGeminiModelsWithApiKey('gemini-key')).resolves.toEqual([
      'gemini-2.5-flash',
      'gemini-2.5-pro'
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)

    const firstPageUrl = fetchMock.mock.calls[0][0] as URL
    expect(firstPageUrl.searchParams.get('key')).toBe('gemini-key')
    expect(firstPageUrl.searchParams.get('pageSize')).toBe('1000')
    expect(firstPageUrl.searchParams.get('pageToken')).toBeNull()

    const secondPageUrl = fetchMock.mock.calls[1][0] as URL
    expect(secondPageUrl.searchParams.get('pageToken')).toBe('second-page')
  })

  it('reports Gemini model list request failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createFetchResponse({}, 500)))

    await expect(listGeminiModelsWithApiKey('gemini-key')).rejects.toThrow(
      'Unable to load Gemini models (500).'
    )
  })

  it('includes Gemini API error response messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createFetchResponse(
          {
            error: {
              message: 'API key not valid. Please pass a valid API key.'
            }
          },
          400
        )
      )
    )

    await expect(listGeminiModelsWithApiKey('gemini-key')).rejects.toThrow(
      'Unable to load Gemini models (400): API key not valid. Please pass a valid API key.'
    )
  })
})
