import { isCloudflareAccountId, type JevRoutingConfiguration } from '../shared/jev'
import { getStoredJevConfiguration } from './settings'

// Production Jev configuration is independent of answer providers and environment credentials.
export const getJevRoutingConfiguration = async (): Promise<JevRoutingConfiguration | undefined> => {
  const configured = await getStoredJevConfiguration()
  if (!configured.enabled) return undefined
  const channel = configured.channel ?? 'openrouter'
  const apiKey = configured.apiKey?.trim()
  if (!apiKey) return undefined
  if (channel === 'cloudflare') {
    const accountId = configured.accountId?.trim()
    if (!accountId || !isCloudflareAccountId(accountId)) return undefined
    return { channel, apiKey, accountId }
  }
  return { channel, apiKey }
}

export const getJevRoutingApiKey = async (): Promise<string | undefined> =>
  (await getJevRoutingConfiguration())?.apiKey
