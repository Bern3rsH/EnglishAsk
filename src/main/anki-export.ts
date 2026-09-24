import { randomUUID } from 'node:crypto'
import { lstat, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { parseAnkiDraftSet, type AnkiDraftSet, type ExportAnkiCardsRequest, type ExportedAnkiCards } from '../shared/anki'
import { loadAnkiDrafts } from './anki-drafts'

const MAX_EXPORT_NAME_LENGTH = 80
const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\[/g, '&#91;')
  .replace(/\r\n?|\n/g, '<br>').replace(/\t/g, '&#9;')
const quoteField = (value: string): string => `"${value.replace(/"/g, '""')}"`

/** Anki text import: two Basic fields plus a special tags column. */
export const formatAnkiExport = (input: AnkiDraftSet): { text: string; count: number } => {
  const drafts = parseAnkiDraftSet(input)
  const selected = drafts.cards.filter(card => card.selected)
  if (!selected.length) throw new Error('请至少勾选一张卡片。')
  const rows = selected.map(card => {
    const explanation = card.explanation ? `<hr><div>${escapeHtml(card.explanation)}</div>` : ''
    const back = `<div data-englishask-note-id="${escapeHtml(drafts.sourceNoteId)}" data-englishask-card-id="${escapeHtml(card.id)}">${escapeHtml(card.back)}${explanation}</div>`
    return [escapeHtml(card.front), back, card.tags.join(' ')].map(quoteField).join('\t')
  })
  return { count: selected.length, text: [
    '#separator:Tab', '#html:true', '#notetype:Basic', '#tags column:3',
    '#columns:Front\tBack\tTags', ...rows, ''
  ].join('\n') }
}

export const getAnkiExportFileName = (title: string): string => {
  const name = Array.from(title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim()).slice(0, MAX_EXPORT_NAME_LENGTH).join('')
  return `${name || 'EnglishAsk'}-Anki.txt`
}

const validateRequest = (input: unknown): ExportAnkiCardsRequest => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('导出请求无效。')
  const request = input as Partial<ExportAnkiCardsRequest>
  if (typeof request.noteId !== 'string' || typeof request.expectedDirectory !== 'string' ||
    typeof request.expectedMarkdown !== 'string' || typeof request.expectedDraftRevision !== 'string' ||
    !request.expectedDraftRevision || request.expectedDraftRevision.length > 80) throw new Error('导出请求缺少最新草稿快照。')
  return request as ExportAnkiCardsRequest
}

export const exportAnkiCards = async (
  input: unknown,
  choosePath: (fileName: string) => Promise<string | undefined>,
  directory?: string
): Promise<ExportedAnkiCards> => {
  const request = validateRequest(input)
  const readCurrent = async (): Promise<AnkiDraftSet> => {
    const loaded = await loadAnkiDrafts(request, directory)
    if (!loaded.drafts || loaded.stale || loaded.drafts.revision !== request.expectedDraftRevision) {
      throw new Error('卡片来源或草稿已变更，请重新打开后导出。')
    }
    return loaded.drafts
  }
  const drafts = await readCurrent()
  const output = formatAnkiExport(drafts)
  const filePath = await choosePath(getAnkiExportFileName(drafts.sourceTitle))
  if (!filePath) return { cancelled: true }
  if (extname(filePath).toLowerCase() !== '.txt') throw new Error('请选择 .txt 文件名以便导入 Anki。')
  try {
    const stats = await lstat(filePath)
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('导出位置必须是普通文件。')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const temporaryPath = join(dirname(filePath), `.englishask-export-${randomUUID()}.tmp`)
  try {
    await writeFile(temporaryPath, output.text, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await readCurrent()
    await rename(temporaryPath, filePath)
  } finally { await unlink(temporaryPath).catch(() => undefined) }
  return { cancelled: false, filePath, count: output.count }
}
