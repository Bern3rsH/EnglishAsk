import assert from 'node:assert/strict'

export function verifyArchiveFiles(entries) {
  // @electron/asar lists paths using the host OS separator, including on Windows.
  const files = entries.map(entry => entry.replaceAll('\\', '/'))
  assert(files.includes('/node_modules/zod/package.json'), 'Packaged app must include the AI SDK zod runtime dependency')
  assert(!files.some(file => /(^|\/)\.env(?:\.|$)/.test(file)), 'Environment files must not be packaged')
  assert(!files.some(file => /^\/(src|scripts|\.git)(\/|$)/.test(file)), 'Development files must not be packaged')
}
