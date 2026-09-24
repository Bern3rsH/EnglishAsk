import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('development runtime', () => {
  it('watches main and preload code so backend fixes reload in the running app', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))

    expect(manifest.scripts.dev).toBe('electron-vite dev --watch')
  })
})
