export type MarkdownTableAlignment = 'center' | 'left' | 'right'

export type MarkdownTablePreview = {
  alignments: MarkdownTableAlignment[]
  headers: string[]
  rows: string[][]
}

const splitMarkdownTableRow = (row: string): string[] => {
  let rowContent = row.trim()

  if (rowContent.startsWith('|')) {
    rowContent = rowContent.slice(1)
  }

  if (rowContent.endsWith('|') && !rowContent.endsWith('\\|')) {
    rowContent = rowContent.slice(0, -1)
  }

  const cells: string[] = []
  let currentCell = ''
  let isInsideCode = false

  for (let index = 0; index < rowContent.length; index += 1) {
    const character = rowContent[index]

    if (character === '\\' && rowContent[index + 1] === '|') {
      currentCell += '|'
      index += 1
    } else if (character === '`') {
      isInsideCode = !isInsideCode
      currentCell += character
    } else if (character === '|' && !isInsideCode) {
      cells.push(currentCell.trim())
      currentCell = ''
    } else {
      currentCell += character
    }
  }

  cells.push(currentCell.trim())
  return cells
}

export const parseMarkdownTable = (source: string): MarkdownTablePreview | null => {
  const lines = source.split(/\r?\n/).filter((line) => line.trim().length > 0)

  if (lines.length < 2 || !lines[0].includes('|') || !lines[1].includes('|')) {
    return null
  }

  const headers = splitMarkdownTableRow(lines[0])
  const delimiters = splitMarkdownTableRow(lines[1])
  const isValidDelimiter = delimiters.every((delimiter) => /^:?-{3,}:?$/.test(delimiter))

  if (headers.length === 0 || headers.length !== delimiters.length || !isValidDelimiter) {
    return null
  }

  const alignments = delimiters.map<MarkdownTableAlignment>((delimiter) => {
    if (delimiter.startsWith(':') && delimiter.endsWith(':')) {
      return 'center'
    }

    return delimiter.endsWith(':') ? 'right' : 'left'
  })
  const rows = lines.slice(2).map((line) => {
    const cells = splitMarkdownTableRow(line)
    return headers.map((_, index) => cells[index] ?? '')
  })

  return { alignments, headers, rows }
}
