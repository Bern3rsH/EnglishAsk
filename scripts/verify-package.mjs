import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { verifyArchiveFiles } from './package-archive-checks.mjs'

const require = createRequire(import.meta.url)
const { listPackage, extractAll } = require('@electron/asar')
const archive = resolve(process.argv[2] ?? 'release/mac-arm64/EnglishAsk.app/Contents/Resources/app.asar')
verifyArchiveFiles(listPackage(archive))
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
