import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = fileURLToPath(new URL('../', import.meta.url))

export function extractReleaseNotes(content, version) {
  assert(/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version), 'Invalid release version')
  const sections = []
  let current
  let fence
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined
    }
    const heading = !fence && !marker && line.match(/^##\s+(\S+)/)
    if (heading) {
      current = { version: heading[1].replace(/^v/, ''), lines: [] }
      sections.push(current)
    } else if (current) current.lines.push(line)
  }
  const matches = sections.filter(section => section.version === version)
  assert.equal(matches.length, 1, `Expected exactly one release-notes.md section for v${version}`)
  const notes = matches[0].lines.join('\n').trim()
  assert(notes.replace(/<!--[\s\S]*?-->/g, '').trim(), `Release notes for v${version} are empty`)
  return `${notes}\n`
}

export function loadReleaseNotes(root = projectRoot, tag) {
  const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  if (tag !== undefined) assert.equal(tag, `v${version}`, 'Release tag must match package.json version')
  return { version, notes: extractReleaseNotes(readFileSync(resolve(root, 'release-notes.md'), 'utf8'), version) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    const options = {}
    while (args.length) {
      const flag = args.shift()
      assert(['--output', '--tag'].includes(flag) && args[0] && !args[0].startsWith('--'), `Invalid argument: ${flag}`)
      assert(!options[flag], `Duplicate argument: ${flag}`)
      options[flag] = args.shift()
    }
    const { notes } = loadReleaseNotes(projectRoot, options['--tag'])
    if (options['--output']) writeFileSync(options['--output'], notes)
    else process.stdout.write(notes)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
