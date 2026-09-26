import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { extractReleaseNotes, loadReleaseNotes, projectRoot } from './extract-release-notes.mjs'
import { packageRelease } from './package-release.mjs'
import { publishRelease, releaseAssetNames } from './publish-release.mjs'
import { verifyArchiveFiles } from './package-archive-checks.mjs'

for (const separator of ['/', '\\']) {
  test(`archive checks accept ${JSON.stringify(separator)} paths and still reject missing dependencies and sensitive files`, () => {
    const path = value => value.replaceAll('/', separator)
    const required = path('/node_modules/zod/package.json')
    assert.doesNotThrow(() => verifyArchiveFiles([required, path('/out/main/index.js')]))
    assert.throws(() => verifyArchiveFiles([path('/out/main/index.js')]), /zod/)
    for (const forbidden of ['/.env', '/nested/.env.local', '/src/main/index.ts', '/scripts/build.js', '/.git/config']) {
      assert.throws(() => verifyArchiveFiles([required, path(forbidden)]), /must not be packaged/)
    }
  })
}

test('extracts only the exact version, preserving categories, Markdown and fenced headings', () => {
  const content = '# Notes\r\n## v1.2.30\r\nwrong\r\n## v1.2.3 — date\r\n### 中文\r\n- 更新\r\n```md\r\n## example\r\n```\r\n## v1.2.2\r\nold'
  assert.equal(extractReleaseNotes(content, '1.2.3'), '### 中文\n- 更新\n```md\n## example\n```\n')
  assert.equal(extractReleaseNotes('## 1.2.3-beta.1\n- Beta', '1.2.3-beta.1'), '- Beta\n')
})

test('rejects missing, empty, comment-only, duplicate and non-exact versions', () => {
  for (const content of ['## v1.2.30\nx', '## v1x2x3\nx', '## v1.2.3\n  ', '## v1.2.3\n<!-- TODO -->', '## v1.2.3\na\n## 1.2.3\nb']) {
    assert.throws(() => extractReleaseNotes(content, '1.2.3'))
  }
  assert.throws(() => extractReleaseNotes('## anything\nx', '.*'), /Invalid/)
})

test('real CLI writes notes to a file and rejects malformed arguments or tag mismatch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'englishask-notes-test-'))
  const script = join(projectRoot, 'scripts/extract-release-notes.mjs')
  const { version, notes } = loadReleaseNotes()
  try {
    const output = join(directory, 'notes.md')
    execFileSync(process.execPath, [script, '--tag', `v${version}`, '--output', output])
    assert.equal(readFileSync(output, 'utf8'), notes)
    for (const args of [['--output'], ['--unknown', 'x'], ['--tag', 'v99.0.0'], ['--tag', `v${version}`, '--tag', `v${version}`]]) {
      assert.throws(() => execFileSync(process.execPath, [script, ...args], { stdio: 'pipe' }))
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

for (const [target, platform, archiveCount] of [['mac', 'darwin', 2], ['win', 'win32', 1]]) {
  test(`${target} builds both required targets before verifying every archive with telemetry disabled`, () => {
    const calls = []
    packageRelease(target, { platform, run: (...args) => calls.push(args) })
    assert.equal(calls.length, 2 + archiveCount)
    assert.equal(calls[0][1].at(-1), 'build')
    assert(calls[1][1].includes('--x64'))
    assert.equal(calls[1][1].includes('--arm64'), target === 'mac')
    assert.deepEqual(calls[1][1].slice(-2), ['--publish', 'never'])
    for (const call of calls) {
      assert.equal(call[2].env.VITE_TELEMETRY_DISABLED, '1')
      assert.equal(call[2].env.VITE_POSTHOG_KEY, '')
    }
    assert(calls.slice(2).every(call => call[1][0] === 'scripts/verify-package.mjs'))
    assert(calls.slice(2).every(call => call[1][1].endsWith('app.asar')))
  })
}

test('wrong host, unsupported target and build failures prevent subsequent packaging steps', () => {
  let calls = 0
  const run = () => { calls++; throw new Error('Build failed') }
  assert.throws(() => packageRelease('win', { platform: 'darwin', run }), /operating system/)
  assert.throws(() => packageRelease('linux', { run }), /target/)
  assert.equal(calls, 0)
  assert.throws(() => packageRelease('mac', { platform: 'darwin', run }), /Build failed/)
  assert.equal(calls, 1)
})

function fixture(callback) {
  const root = mkdtempSync(join(tmpdir(), 'englishask-release-test-'))
  const version = '1.2.3'
  const tag = `v${version}`
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }))
  writeFileSync(join(root, 'release-notes.md'), `## ${tag}\n- Tested release\n`)
  mkdirSync(join(root, 'release'))
  for (const name of releaseAssetNames(version)) writeFileSync(join(root, 'release', name), `artifact ${name}`)
  const calls = []
  const state = { existing: [], failUpload: false, mismatch: false, apiFailure: false }
  const run = (command, args) => {
    assert.equal(command, 'gh')
    calls.push(args)
    if (args.includes('--paginate')) {
      if (state.apiFailure) throw new Error('Network unavailable')
      return JSON.stringify([state.existing])
    }
    if (state.failUpload && (args[1] === 'create' || args[1] === 'upload')) throw new Error('Upload failed')
    if (args[0] === 'api') return JSON.stringify({
      draft: true, body: '- Tested release\n',
      assets: [...releaseAssetNames(version), 'SHA256SUMS.txt'].map(name => {
        const path = join(root, 'release', name)
        return { name, size: statSync(path).size, digest: state.mismatch ? 'sha256:wrong' : `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}` }
      })
    })
    return ''
  }
  try { callback({ root, tag, calls, state, run }) } finally { rmSync(root, { recursive: true, force: true }) }
}

test('publishes exactly seven artifacts plus checksums only after remote verification', () => fixture(({ root, tag, calls, run }) => {
  publishRelease(tag, { root, run })
  const create = calls.find(args => args[1] === 'create')
  assert(create.includes('--draft'))
  assert(create.includes('--verify-tag'))
  assert(create.includes('--notes-file'))
  assert.equal(create.filter(arg => arg.startsWith(join(root, 'release'))).length, 8)
  assert.equal(readFileSync(join(root, 'release/SHA256SUMS.txt'), 'utf8').trim().split('\n').length, 7)
  assert(calls.at(-1).includes('--draft=false'))
}))

test('existing drafts can resume uploads; published releases cannot be overwritten', () => fixture(({ root, tag, calls, state, run }) => {
  state.existing = [{ tag_name: tag, draft: true }]
  publishRelease(tag, { root, run })
  assert(calls.some(args => args[1] === 'upload' && args.includes('--clobber')))
  assert(!calls.some(args => args[1] === 'create'))
  calls.length = 0
  state.existing[0].draft = false
  assert.throws(() => publishRelease(tag, { root, run }), /already published/)
  assert.equal(calls.length, 1)
}))

for (const failure of ['failUpload', 'mismatch', 'apiFailure']) {
  test(`${failure} never makes a release public`, () => fixture(({ root, tag, calls, state, run }) => {
    state[failure] = true
    assert.throws(() => publishRelease(tag, { root, run }))
    assert(!calls.some(args => args.includes('--draft=false')))
  }))
}

test('missing artifacts and mismatched tags fail before any GitHub operation', () => fixture(({ root, tag, calls, run }) => {
  assert.throws(() => publishRelease('v9.0.0', { root, run }), /match/)
  assert.throws(() => publishRelease(undefined, { root, run }), /tag/)
  rmSync(join(root, 'release', releaseAssetNames('1.2.3')[0]))
  assert.throws(() => publishRelease(tag, { root, run }), /ENOENT/)
  assert.equal(calls.length, 0)
}))

test('Windows targets have distinct installer and portable filenames and remain local-only', () => {
  const config = JSON.parse(readFileSync(join(projectRoot, 'electron-builder.json'), 'utf8'))
  assert.deepEqual(config.win.target, ['nsis', 'zip', 'portable'].map(target => ({ target, arch: ['x64'] })))
  assert.notEqual(config.nsis.artifactName, config.portable.artifactName)
  assert.equal(config.nsis.allowToChangeInstallationDirectory, true)
  assert.equal(config.publish, null)
})

test('workflow gates native builds on notes validation and publication on both platforms', () => {
  const require = createRequire(import.meta.url)
  const workflow = require('js-yaml').load(readFileSync(join(projectRoot, '.github/workflows/release.yml'), 'utf8'))
  assert.deepEqual(workflow.on.push.tags, ['v*.*.*'])
  assert('workflow_dispatch' in workflow.on)
  assert.equal(workflow.permissions.contents, 'read')
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.equal(workflow.jobs.build.needs, 'validate')
  assert.deepEqual(workflow.jobs.build.strategy.matrix.include.map(entry => entry.target), ['mac', 'win'])
  assert.equal(workflow.jobs.publish.needs, 'build')
  assert.equal(workflow.jobs.publish.permissions.contents, 'write')
  assert(workflow.jobs.validate.steps.some(step => step.run?.includes('--tag "$RELEASE_TAG"')))
})
