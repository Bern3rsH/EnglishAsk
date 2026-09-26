import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectRoot } from './extract-release-notes.mjs'

const require = createRequire(import.meta.url)

export function packageRelease(target, { platform = process.platform, run = execFileSync } = {}) {
  assert(['mac', 'win'].includes(target), 'Packaging target must be mac or win')
  assert.equal(platform, target === 'mac' ? 'darwin' : 'win32', 'Package on the target operating system')
  const options = {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, VITE_TELEMETRY_DISABLED: '1', VITE_POSTHOG_KEY: '', CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  }
  assert(process.env.npm_execpath, 'Run packaging through npm run dist:mac or npm run dist:win')
  run(process.execPath, [process.env.npm_execpath, 'run', 'build'], options)
  run(process.execPath, [require.resolve('electron-builder/cli.js'), '--config', 'electron-builder.json',
    `--${target}`, ...(target === 'mac' ? ['--arm64', '--x64'] : ['--x64']), '--publish', 'never'], options)
  const archives = target === 'mac'
    ? ['release/mac-arm64/EnglishAsk.app/Contents/Resources/app.asar', 'release/mac/EnglishAsk.app/Contents/Resources/app.asar']
    : ['release/win-unpacked/resources/app.asar']
  for (const archive of archives) run(process.execPath, ['scripts/verify-package.mjs', archive], options)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { packageRelease(process.argv[2]) } catch (error) {
    console.error(`Packaging failed: ${error.message}`)
    process.exitCode = 1
  }
}
