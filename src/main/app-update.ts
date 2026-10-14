import { z } from 'zod'
import type { AppUpdateResult } from '../shared/app-update'

export const LATEST_RELEASE_API = 'https://api.github.com/repos/Bern3rsH/EnglishAsk/releases/latest'
export const APP_DOWNLOAD_URL = 'https://github.com/Bern3rsH/EnglishAsk/releases/latest'
export const UPDATE_TIMEOUT_MS = 15_000
const MAX_RELEASE_NOTES_LENGTH = 100_000
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
const releaseSchema = z.object({
  tag_name: z.string(), draft: z.literal(false), prerelease: z.literal(false),
  body: z.string().max(MAX_RELEASE_NOTES_LENGTH).nullable()
})

// The endpoint serves stable releases; a matching stable version is newer than a local prerelease.
export function isNewerStableVersion(latestVersion: string, currentVersion: string): boolean {
  const latest = versionPattern.exec(latestVersion)
  const current = versionPattern.exec(currentVersion)
  if (!latest || latest[4] || !current) throw new Error('版本号格式无效。')
  for (let part = 1; part <= 3; part++) {
    const difference = BigInt(latest[part]) - BigInt(current[part])
    if (difference !== 0n) return difference > 0n
  }
  return Boolean(current[4])
}

export function createAppUpdateChecker(getVersion: () => string, fetchRelease: typeof fetch = fetch) {
  let pending: Promise<AppUpdateResult> | undefined
  return (): Promise<AppUpdateResult> => {
    if (pending) return pending
    const currentVersion = getVersion()
    pending = (async (): Promise<AppUpdateResult> => {
      try {
        const response = await fetchRelease(LATEST_RELEASE_API, {
          headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS), redirect: 'error'
        })
        if (!response.ok) {
          if (response.status === 404) throw new Error('暂未找到公开的正式版本，请稍后重试或前往下载页。')
          if (response.status === 403 || response.status === 429) throw new Error('检查更新过于频繁，请稍后重试或前往下载页。')
          throw new Error('更新服务暂时不可用，请稍后重试。')
        }
        const release = releaseSchema.parse(await response.json())
        const latestVersion = release.tag_name.replace(/^v/, '')
        return {
          status: isNewerStableVersion(latestVersion, currentVersion) ? 'available' : 'current',
          currentVersion, latestVersion, releaseNotes: release.body?.trim() ?? ''
        }
      } catch (error) {
        const knownMessage = error instanceof Error && /^(暂未找到|检查更新过于频繁|更新服务暂时|版本号格式)/.test(error.message)
        console.warn('[AppUpdate] Check failed', error instanceof Error ? error.name : 'UnknownError')
        return { status: 'error', currentVersion, error: knownMessage ? (error as Error).message
          : '无法检查更新，请检查网络后重试，或直接前往下载页。' }
      }
    })().finally(() => { pending = undefined })
    return pending
  }
}

export async function openAppDownload(openExternal: (url: string) => Promise<unknown>) {
  try {
    await openExternal(APP_DOWNLOAD_URL)
    return { ok: true } as const
  } catch {
    console.warn('[AppUpdate] Could not open download page')
    return { ok: false, error: '无法打开浏览器，请稍后重试。' } as const
  }
}
