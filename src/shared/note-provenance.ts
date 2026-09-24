/** App-owned YAML flow mapping. Other frontmatter is kept byte-for-byte. */
export interface NoteSource {
  ask_id: string
  message_ids: string[]
}

export interface NoteProvenance {
  version: 1
  note_id: string
  sources: NoteSource[]
}

const METADATA_KEY = 'english_ask'
const MAX_SOURCE_COUNT = 1_000
const MAX_MESSAGE_COUNT = 10_000
const MAX_REFERENCE_LENGTH = 240
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const METADATA_LINE = /^english_ask:[^\r\n]*(?:\r?\n|$)/gm
const RESERVED_KEY_LINE = /^(?:english_ask|"english_ask"|'english_ask')[ \t]*:/gm

export const validateSourceReference = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_REFERENCE_LENGTH || /[\x00-\x1f]/.test(value)) {
    throw new Error('Note 来源 ID 无效。')
  }
  return value
}

export const mergeNoteSources = (...groups: NoteSource[][]): NoteSource[] => {
  const sources = new Map<string, Set<string>>()
  for (const group of groups) {
    for (const source of group) {
      const askId = validateSourceReference(source.ask_id)
      const messageIds = sources.get(askId) ?? new Set<string>()
      for (const messageId of source.message_ids) messageIds.add(validateSourceReference(messageId))
      sources.set(askId, messageIds)
    }
  }
  if (sources.size > MAX_SOURCE_COUNT || [...sources.values()].reduce((total, ids) => total + ids.size, 0) > MAX_MESSAGE_COUNT) {
    throw new Error('Note 来源数量超过上限。')
  }
  return [...sources].map(([ask_id, ids]) => ({ ask_id, message_ids: [...ids] }))
}

const splitFrontmatter = (markdown: string) => {
  const match = markdown.match(/^(\uFEFF?---\r?\n)([\s\S]*?)(^---[ \t]*(?:\r?\n|$))/m)
  if (match?.index === 0) return { opening: match[1], fields: match[2], closing: match[3], body: markdown.slice(match[0].length) }
  if (/^\uFEFF?---\r?\n/.test(markdown)) throw new Error('Note frontmatter 未闭合，请先修复文件。')
  return { opening: '', fields: '', closing: '', body: markdown }
}

export const readNoteProvenance = (markdown: string): NoteProvenance | undefined => {
  const { fields } = splitFrontmatter(markdown)
  const lines = [...fields.matchAll(METADATA_LINE)]
  const reservedKeys = [...fields.matchAll(RESERVED_KEY_LINE)]
  if (!reservedKeys.length) return undefined
  try {
    if (lines.length !== 1 || reservedKeys.length !== 1) throw new Error('unsupported or duplicate key')
    const value = JSON.parse(lines[0][0].slice(METADATA_KEY.length + 1))
    if (!value || value.version !== 1 || typeof value.note_id !== 'string' || !UUID_PATTERN.test(value.note_id) ||
      !Array.isArray(value.sources) || value.sources.some((source: NoteSource) =>
        !source || !Array.isArray(source.message_ids) || !source.message_ids.length)) throw new Error('invalid metadata')
    return { version: 1, note_id: value.note_id, sources: mergeNoteSources(value.sources) }
  } catch {
    throw new Error('Note 的 english_ask 元数据无效或版本不支持，请先修复文件。')
  }
}

export const withoutNoteProvenance = (markdown: string): string => {
  // Corrupt/external metadata stays visible and editable; never silently discard it.
  try {
    if (!readNoteProvenance(markdown)) return markdown
    const { opening, fields, closing, body } = splitFrontmatter(markdown)
    const remaining = fields.replace(METADATA_LINE, '')
    return remaining ? `${opening}${remaining}${closing}${body}` : body
  } catch {
    return markdown
  }
}

export const withNoteProvenance = (markdown: string, metadata: NoteProvenance): string => {
  readNoteProvenance(markdown)
  const { opening, fields, closing, body } = splitFrontmatter(markdown)
  const newline = opening.endsWith('\r\n') ? '\r\n' : '\n'
  const line = `${METADATA_KEY}: ${JSON.stringify(metadata)}${newline}`
  const result = opening
    ? `${opening}${fields.replace(METADATA_LINE, '')}${line}${closing}${body}`
    : `---\n${line}---\n${body}`
  readNoteProvenance(result)
  return result
}

export const replaceNoteBody = (original: string, body: string): string => {
  try {
    const metadata = readNoteProvenance(original)
    return metadata ? withNoteProvenance(body, metadata) : body
  } catch {
    // Allow incomplete frontmatter while typing. Storage validates it before writing
    // and restores the persisted identity/sources when the draft becomes valid.
    return body
  }
}

/** AI edits the learning content only; file-owned frontmatter is authoritative. */
export const preserveNoteFrontmatter = (original: string, generated: string): string => {
  const previous = splitFrontmatter(original)
  const next = splitFrontmatter(generated)
  return `${previous.opening}${previous.fields}${previous.closing}${next.body}`
}
