import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { listPackage, extractAll } = require('@electron/asar')
const archive = resolve(process.argv[2] ?? 'release/mac-arm64/EnglishAsk.app/Contents/Resources/app.asar')
const files = listPackage(archive)
assert(files.includes('/node_modules/zod/package.json'), 'Packaged app must include the AI SDK zod runtime dependency')
assert(!files.some(file => /(^|\/)\.env(?:\.|$)/.test(file)), 'Environment files must not be packaged')
assert(!files.some(file => /^\/(src|scripts|\.git)(\/|$)/.test(file)), 'Development files must not be packaged')
const isolatedDirectory = mkdtempSync(join(tmpdir(), 'englishask-package-dependencies-'))

try {
  extractAll(archive, isolatedDirectory)
  // Resolve from the extracted app, never from this repository's node_modules.
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    await import('zod');
    await import('ai');
    await import('@ai-sdk/openai');
    await import('msedge-tts');
  `], {
    cwd: isolatedDirectory,
    env: {
      PATH: process.env.PATH,
      HOME: isolatedDirectory,
      TMPDIR: tmpdir(),
      ...(process.platform === 'win32' ? {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        TEMP: tmpdir(),
        TMP: tmpdir(),
        USERPROFILE: isolatedDirectory
      } : {})
    },
    stdio: 'pipe',
    timeout: 30000
  })
  console.log('PASS: packaged runtime dependencies load outside the repository; archive exclusions verified.')
} finally {
  rmSync(isolatedDirectory, { recursive: true, force: true })
}
