import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { getStoredJevConfiguration, getStoredProviderApiKey } from './settings'
import { getJevRoutingConfiguration } from './jev-routing-config'
import { JEV_CHANNELS, type JevChannel } from '../shared/jev'

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))
vi.mock('./settings', () => ({ getStoredProviderApiKey: vi.fn(), getStoredJevConfiguration: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getStoredProviderApiKey).mockResolvedValue('shared-provider-key')
  vi.mocked(readFile).mockResolvedValue('OPENROUTER_API_KEY=local-secret')
  for (const { keyEnv } of Object.values(JEV_CHANNELS)) vi.stubEnv(keyEnv, 'environment-key')
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', '0123456789abcdef0123456789abcdef')
})
afterEach(() => vi.unstubAllEnvs())

it.each(Object.keys(JEV_CHANNELS) as JevChannel[])('requires a saved dedicated %s key and never consults shared sources', async channel => {
  vi.mocked(getStoredJevConfiguration).mockResolvedValue({ enabled: true, channel })
  expect(await getJevRoutingConfiguration()).toBeUndefined()
  expect(getStoredProviderApiKey).not.toHaveBeenCalled()
  expect(readFile).not.toHaveBeenCalled()
  vi.mocked(getStoredJevConfiguration).mockResolvedValue({ enabled: true, channel, apiKey: ' dedicated-key ', accountId: '0123456789abcdef0123456789abcdef' })
  expect(await getJevRoutingConfiguration()).toMatchObject({ channel, apiKey: 'dedicated-key' })
})

it('uses only the saved enable switch, independently of environment switches', async () => {
  vi.stubEnv('JEV_ROUTER_ENABLED', '0')
  vi.mocked(getStoredJevConfiguration).mockResolvedValue({ enabled: true, channel: 'openrouter', apiKey: 'dedicated-key' })
  expect(await getJevRoutingConfiguration()).toEqual({ channel: 'openrouter', apiKey: 'dedicated-key' })
  vi.stubEnv('JEV_ROUTER_ENABLED', '1')
  vi.mocked(getStoredJevConfiguration).mockResolvedValue({ enabled: false, channel: 'openrouter', apiKey: 'dedicated-key' })
  expect(await getJevRoutingConfiguration()).toBeUndefined()
})

it.each([undefined, '', '../invalid'])('requires a saved valid Cloudflare account instead of environment fallback: %s', async accountId => {
  vi.mocked(getStoredJevConfiguration).mockResolvedValue({ enabled: true, channel: 'cloudflare', apiKey: 'dedicated-key', accountId })
  expect(await getJevRoutingConfiguration()).toBeUndefined()
})

it('does not re-enable Jev via shared credentials after its key is removed', async () => {
  vi.mocked(getStoredJevConfiguration).mockResolvedValue({ enabled: true, channel: 'openrouter', apiKey: '   ' })
  expect(await getJevRoutingConfiguration()).toBeUndefined()
})
