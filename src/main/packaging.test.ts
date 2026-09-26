import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync(resolve('electron-builder.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))

describe('macOS prerelease packaging', () => {
  it('ships zod explicitly and verifies dependencies after packaging', () => {
    expect(manifest.dependencies.zod).toBeTruthy()
    const lock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'))
    expect(lock.packages[''].dependencies.zod).toBe(manifest.dependencies.zod)
    expect(lock.packages['node_modules/zod'].peer).not.toBe(true)
    expect(manifest.scripts['package:mac']).toContain('&& npm run verify:package')
    expect(manifest.scripts['verify:package']).toBe('node scripts/verify-package.mjs')
  })

  it('includes only compiled application files and excludes environment files', () => {
    expect(config.files.filter((entry: string) => !entry.startsWith('!')))
      .toEqual(['out/**/*', 'package.json'])
    expect(config.files).toContain('!**/.env')
    expect(config.files).toContain('!**/.env.*')
    expect(config.asar).toBe(true)
    expect(manifest.main).toBe('out/main/index.js')
  })

  it('uses the accepted PNG and explicit ad-hoc signing without automatic publication', () => {
    const icon = readFileSync(resolve(config.mac.icon))
    expect(icon.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(config.productName).toBe('EnglishAsk')
    expect(config.mac.target).toEqual(['dmg', 'zip'])
    expect(config.mac.identity).toBe('-')
    expect(config.mac.notarize).toBe(false)
    expect(config.publish).toBeNull()
    expect(manifest.scripts['package:mac']).toContain('VITE_TELEMETRY_DISABLED=1')
    expect(manifest.scripts['package:mac']).toContain('--publish never')
  })
})
