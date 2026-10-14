import assert from 'node:assert/strict'

export function verifyArchiveFiles(entries) {
  // @electron/asar lists paths using the host OS separator, including on Windows.
  const files = entries.map(entry => entry.replaceAll('\\', '/'))
  assert(files.includes('/node_modules/zod/package.json'), 'Packaged app must include the AI SDK zod runtime dependency')
  assert(!files.some(file => /(^|\/)\.env(?:\.|$)/.test(file)), 'Environment files must not be packaged')
  assert(!files.some(file => /^\/(src|scripts|\.git)(\/|$)/.test(file)), 'Development files must not be packaged')
}

export function verifyEmbeddingArchive(entries, platform, architecture) {
  const files = entries.map(entry => entry.replaceAll('\\', '/'))
  const nativePackage = platform === 'darwin'
    ? (architecture === 'arm64' ? 'mac-arm64-metal' : 'mac-x64') : 'win-x64'
  assert((platform === 'darwin' && ['arm64', 'x64'].includes(architecture)) || (platform === 'win32' && architecture === 'x64'), 'Unsupported native embedding target')
  assert(files.includes('/node_modules/node-llama-cpp/package.json'), 'Missing local embedding runtime')
  const nativeRoot = `/node_modules/@node-llama-cpp/${nativePackage}/`
  assert(files.some(file => file.startsWith(nativeRoot) && file.endsWith('/llama-addon.node')), `Missing native embedding binary for ${platform}/${architecture}`)
  assert(!files.some(file => /\.gguf$/i.test(file)), 'Model weights must be downloaded into userData, not bundled')
}
