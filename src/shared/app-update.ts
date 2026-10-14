export const APP_UPDATE_CHANNELS = {
  info: 'app-update:info',
  check: 'app-update:check',
  download: 'app-update:download'
} as const

export interface AppVersionInfo {
  currentVersion: string
  isPackaged: boolean
}
export type AppUpdateResult =
  | { status: 'available' | 'current'; currentVersion: string; latestVersion: string; releaseNotes: string }
  | { status: 'error'; currentVersion: string; error: string }

export interface AppUpdateBridge {
  getAppVersion: () => Promise<AppVersionInfo>
  checkAppUpdate: () => Promise<AppUpdateResult>
  openAppDownload: () => Promise<{ ok: true } | { ok: false; error: string }>
}
