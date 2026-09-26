import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadReleaseNotes, projectRoot } from './extract-release-notes.mjs'

const repository = 'Bern3rsH/EnglishAsk'

export function releaseAssetNames(version) {
  return [
    ...['arm64', 'x64'].flatMap(architecture => ['dmg', 'zip'].map(extension => `EnglishAsk-${version}-mac-${architecture}.${extension}`)),
    `EnglishAsk-${version}-win-x64.zip`,
    `EnglishAsk-${version}-win-x64-setup.exe`,
    `EnglishAsk-${version}-win-x64-portable.exe`
  ]
}

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')

export function publishRelease(tag, { root = projectRoot, run = execFileSync } = {}) {
  assert(tag, 'Provide the existing release tag, for example v0.1.1')
  const { version, notes } = loadReleaseNotes(root, tag)
  const assets = releaseAssetNames(version).map(name => ({ name, path: join(root, 'release', name) }))
  for (const asset of assets) {
    assert(statSync(asset.path).isFile() && statSync(asset.path).size > 0, `Missing or empty artifact: ${asset.name}`)
  }
  const checksums = join(root, 'release', 'SHA256SUMS.txt')
  writeFileSync(checksums, assets.map(asset => `${sha256(asset.path)}  ${asset.name}\n`).join(''))
  assets.push({ name: 'SHA256SUMS.txt', path: checksums })
  const gh = args => run('gh', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  // Listing errors abort; authentication/network failures must never be treated as a missing release.
  const releases = JSON.parse(gh(['api', `repos/${repository}/releases`, '--paginate', '--slurp'])).flat()
  const existing = releases.find(release => release.tag_name === tag)
  assert(!existing || existing.draft, `Release ${tag} is already published; use a new version`)
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'englishask-release-'))
  try {
    const notesPath = join(temporaryDirectory, 'notes.md')
    writeFileSync(notesPath, notes)
    if (existing) {
      gh(['release', 'edit', tag, '--repo', repository, '--notes-file', notesPath])
      gh(['release', 'upload', tag, ...assets.map(asset => asset.path), '--repo', repository, '--clobber'])
    } else {
      gh(['release', 'create', tag, ...assets.map(asset => asset.path), '--repo', repository,
        '--verify-tag', '--draft', '--title', `EnglishAsk ${tag}`, '--notes-file', notesPath,
        ...(version.includes('-') ? ['--prerelease'] : [])])
    }
    const remote = JSON.parse(gh(['api', `repos/${repository}/releases/tags/${tag}`]))
    assert(remote.draft, 'Release must remain a draft until all uploads are verified')
    assert.equal(remote.body?.trim(), notes.trim(), 'Uploaded release notes do not match')
    assert.equal(remote.assets.length, assets.length, 'Unexpected remote release assets')
    for (const asset of assets) {
      const uploaded = remote.assets.find(candidate => candidate.name === asset.name)
      assert(uploaded, `Missing remote asset: ${asset.name}`)
      assert.equal(uploaded.size, statSync(asset.path).size, `Remote size mismatch: ${asset.name}`)
      assert.equal(uploaded.digest, `sha256:${sha256(asset.path)}`, `Remote checksum mismatch: ${asset.name}`)
    }
    gh(['release', 'edit', tag, '--repo', repository, '--draft=false', `--prerelease=${version.includes('-')}`])
    return `https://github.com/${repository}/releases/tag/${tag}`
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(`Published ${publishRelease(process.argv[2])}`) } catch (error) {
    console.error(`Release failed: ${error.message}`)
    process.exitCode = 1
  }
}
