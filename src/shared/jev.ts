export const JEV_CHANNELS = {
  openrouter: { label: 'OpenRouter', model: 'typesafe/jev-1.13', keyEnv: 'OPENROUTER_API_KEY' },
  vercel: { label: 'Vercel AI Gateway', model: 'typesafe-ai/jev', keyEnv: 'AI_GATEWAY_API_KEY' },
  typesafe: { label: 'TypeSafe', model: 'jev-latest', keyEnv: 'TYPESAFE_API_KEY' },
  cloudflare: { label: 'Cloudflare', model: 'typesafe/jev', keyEnv: 'CLOUDFLARE_API_TOKEN' }
} as const

export type JevChannel = keyof typeof JEV_CHANNELS
export const isJevChannel = (value: unknown): value is JevChannel =>
  typeof value === 'string' && Object.hasOwn(JEV_CHANNELS, value)

export interface JevRoutingConfiguration {
  channel: JevChannel
  apiKey: string
  accountId?: string
}

export const isCloudflareAccountId = (value: string): boolean => /^[a-f0-9]{32}$/i.test(value)
