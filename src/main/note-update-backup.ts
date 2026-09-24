import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const BACKUP_DIRECTORY = '.englishask-versions'
const MAX_BACKUP_BYTES = 32 * 1024 * 1024

export interface NoteUpdateBackup {
  before: string
  after: string
}

const getBackupPath = (directory: string, id: string): string =>
  join(directory, BACKUP_DIRECTORY, `${createHash('sha256').update(id).digest('hex')}.json`)

const validateBackupDirectory = async (directory: string): Promise<void> => {
  const stats = await lstat(join(directory, BACKUP_DIRECTORY))
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('笔记版本目录无效，无法保存更新前的版本。')
  }
}

export const readNoteUpdateBackup = async (
  directory: string,
  id: string
): Promise<NoteUpdateBackup | null> => {
  try {
    await validateBackupDirectory(directory)
    const path = getBackupPath(directory, id)
    const stats = await lstat(path)
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_BACKUP_BYTES) {
      throw new Error('Invalid Note backup file.')
    }
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!value || typeof value !== 'object' ||
      !('before' in value) || typeof value.before !== 'string' ||
      !('after' in value) || typeof value.after !== 'string') {
      throw new Error('Invalid Note backup content.')
    }
    return { before: value.before, after: value.after }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      console.warn('Unable to read Note update backup.')
    }
    return null
  }
}

export const writeNoteUpdateBackup = async (
  directory: string,
  id: string,
  backup: NoteUpdateBackup
): Promise<void> => {
  await mkdir(join(directory, BACKUP_DIRECTORY), { recursive: true, mode: 0o700 })
  await validateBackupDirectory(directory)
  const path = getBackupPath(directory, id)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(backup), { flag: 'wx', mode: 0o600 })
    await rename(temporaryPath, path)
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }
}
