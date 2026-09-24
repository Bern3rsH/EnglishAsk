import type { ReactElement, ReactNode } from 'react'
import { parser as markdownParser } from '@lezer/markdown'
import { parseMarkdownTable, type MarkdownTablePreview } from './markdown-table'

type MarkdownBlock =
  | {
      type: 'heading'
      level: 1 | 2 | 3
      text: string
    }
  | {
      type: 'paragraph'
      text: string
    }
  | {
      type: 'unordered-list'
      items: string[]
    }
  | {
      type: 'ordered-list'
      items: string[]
      start?: number
    }
  | {
      type: 'blockquote'
      text: string
    }
  | {
      type: 'code'
      language: string
      content: string
    }
  | {
      type: 'table'
      table: MarkdownTablePreview
    }

const FENCED_CODE_MARKER = '```'
const HEADING_PATTERN = /^(#{1,3})\s+(.+)$/
const BLOCKQUOTE_PATTERN = /^>\s?(.+)$/
const INLINE_TOKEN_PATTERN = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g
const LINK_PATTERN = /^\[([^\]]+)\]\(([^)]+)\)$/

const isBlankLine = (line: string): boolean => line.trim().length === 0

type MarkdownListBlock = Extract<MarkdownBlock, { type: 'ordered-list' | 'unordered-list' }>

const getMarkdownListBlocks = (
  content: string
): Map<number, { block: MarkdownListBlock; endOffset: number }> => {
  const listBlocks = new Map<number, { block: MarkdownListBlock; endOffset: number }>()
  const document = markdownParser.parse(content).topNode

  // Use the Markdown syntax tree so translations and loose-list paragraphs stay in their item.
  for (let node = document.firstChild; node; node = node.nextSibling) {
    if (node.name !== 'OrderedList' && node.name !== 'BulletList') {
      continue
    }

    const items: string[] = []
    let start = 1

    for (const item of node.getChildren('ListItem')) {
      const marker = item.getChild('ListMark')

      if (!marker) {
        continue
      }

      if (node.name === 'OrderedList' && items.length === 0) {
        start = Number.parseInt(content.slice(marker.from, marker.to), 10)
      }

      items.push(
        content.slice(marker.to, item.to).trim().split('\n').map((line) => line.trim()).join('\n')
      )
    }

    listBlocks.set(node.from, {
      block: node.name === 'OrderedList'
        ? { type: 'ordered-list', items, ...(start !== 1 ? { start } : {}) }
        : { type: 'unordered-list', items },
      endOffset: node.to
    })
  }

  return listBlocks
}

const getMarkdownTableBlock = (
  lines: string[],
  startLineIndex: number
): { nextLineIndex: number; table: MarkdownTablePreview } | null => {
  if (startLineIndex + 1 >= lines.length) {
    return null
  }

  const tableLines = [lines[startLineIndex] ?? '', lines[startLineIndex + 1] ?? '']

  if (!parseMarkdownTable(tableLines.join('\n'))) {
    return null
  }

  let nextLineIndex = startLineIndex + 2

  while (
    nextLineIndex < lines.length &&
    !isBlankLine(lines[nextLineIndex] ?? '') &&
    lines[nextLineIndex]?.includes('|')
  ) {
    tableLines.push(lines[nextLineIndex] ?? '')
    nextLineIndex += 1
  }

  const table = parseMarkdownTable(tableLines.join('\n'))

  return table ? { nextLineIndex, table } : null
}

const isSafeLink = (url: string): boolean => {
  return url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:')
}

export const parseMarkdownBlocks = (content: string): MarkdownBlock[] => {
  const normalizedContent = content.replace(/\r\n/g, '\n')
  const lines = normalizedContent.split('\n')
  const listBlocks = getMarkdownListBlocks(normalizedContent)
  let offset = 0
  const lineOffsets = lines.map((line) => {
    const lineOffset = offset
    offset += line.length + 1
    return lineOffset
  })
  const getListBlock = (index: number) => {
    const line = lines[index] ?? ''
    return listBlocks.get(lineOffsets[index]) ??
      listBlocks.get(lineOffsets[index] + line.length - line.trimStart().length)
  }
  const blocks: MarkdownBlock[] = []
  let lineIndex = 0

  while (lineIndex < lines.length) {
    const currentLine = lines[lineIndex] ?? ''
    const trimmedLine = currentLine.trim()

    if (isBlankLine(currentLine)) {
      lineIndex += 1
      continue
    }

    if (trimmedLine.startsWith(FENCED_CODE_MARKER)) {
      const language = trimmedLine.slice(FENCED_CODE_MARKER.length).trim()
      const codeLines: string[] = []
      lineIndex += 1

      while (lineIndex < lines.length && !lines[lineIndex]?.trim().startsWith(FENCED_CODE_MARKER)) {
        codeLines.push(lines[lineIndex] ?? '')
        lineIndex += 1
      }

      if (lineIndex < lines.length) {
        lineIndex += 1
      }

      blocks.push({
        type: 'code',
        language,
        content: codeLines.join('\n')
      })
      continue
    }

    const tableBlock = getMarkdownTableBlock(lines, lineIndex)

    if (tableBlock) {
      blocks.push({ type: 'table', table: tableBlock.table })
      lineIndex = tableBlock.nextLineIndex
      continue
    }

    const headingMatch = trimmedLine.match(HEADING_PATTERN)

    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: Math.min(headingMatch[1].length, 3) as 1 | 2 | 3,
        text: headingMatch[2].trim()
      })
      lineIndex += 1
      continue
    }

    const listBlock = getListBlock(lineIndex)

    if (listBlock) {
      while (lineIndex < lines.length && lineOffsets[lineIndex] < listBlock.endOffset) {
        lineIndex += 1
      }

      blocks.push(listBlock.block)
      continue
    }

    const blockquoteMatch = trimmedLine.match(BLOCKQUOTE_PATTERN)

    if (blockquoteMatch) {
      const quoteLines: string[] = []

      while (lineIndex < lines.length) {
        const quoteMatch = lines[lineIndex]?.trim().match(BLOCKQUOTE_PATTERN)

        if (!quoteMatch) {
          break
        }

        quoteLines.push(quoteMatch[1].trim())
        lineIndex += 1
      }

      blocks.push({ type: 'blockquote', text: quoteLines.join('\n') })
      continue
    }

    const paragraphLines: string[] = []

    while (
      lineIndex < lines.length &&
      !isBlankLine(lines[lineIndex] ?? '') &&
      !lines[lineIndex]?.trim().startsWith(FENCED_CODE_MARKER) &&
      !lines[lineIndex]?.trim().match(HEADING_PATTERN) &&
      !getListBlock(lineIndex) &&
      !lines[lineIndex]?.trim().match(BLOCKQUOTE_PATTERN) &&
      getMarkdownTableBlock(lines, lineIndex) === null
    ) {
      paragraphLines.push(lines[lineIndex]?.trim() ?? '')
      lineIndex += 1
    }

    blocks.push({ type: 'paragraph', text: paragraphLines.join('\n') })
  }

  return blocks
}

const renderInlineMarkdown = (text: string): ReactNode[] => {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let tokenMatch: RegExpExecArray | null

  INLINE_TOKEN_PATTERN.lastIndex = 0

  while ((tokenMatch = INLINE_TOKEN_PATTERN.exec(text)) !== null) {
    const token = tokenMatch[0]

    if (tokenMatch.index > lastIndex) {
      nodes.push(text.slice(lastIndex, tokenMatch.index))
    }

    if (token.startsWith('`')) {
      nodes.push(<code key={`code-${tokenMatch.index}`}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={`strong-${tokenMatch.index}`}>{token.slice(2, -2)}</strong>)
    } else {
      const linkMatch = token.match(LINK_PATTERN)
      const linkText = linkMatch?.[1] ?? token
      const href = linkMatch?.[2] ?? ''

      nodes.push(
        isSafeLink(href) ? (
          <a href={href} key={`link-${tokenMatch.index}`} rel="noreferrer" target="_blank">
            {linkText}
          </a>
        ) : (
          linkText
        )
      )
    }

    lastIndex = tokenMatch.index + token.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

export const MarkdownContent = ({ content }: { content: string }): ReactElement => {
  const blocks = parseMarkdownBlocks(content)

  return (
    <div className="markdownContent">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const HeadingTag = `h${block.level}` as 'h1' | 'h2' | 'h3'
          return <HeadingTag key={index}>{renderInlineMarkdown(block.text)}</HeadingTag>
        }

        if (block.type === 'unordered-list') {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          )
        }

        if (block.type === 'ordered-list') {
          return (
            <ol key={index} start={block.start}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
              ))}
            </ol>
          )
        }

        if (block.type === 'blockquote') {
          return <blockquote key={index}>{renderInlineMarkdown(block.text)}</blockquote>
        }

        if (block.type === 'table') {
          return (
            <div className="markdownTableWrapper" key={index}>
              <table>
                <thead>
                  <tr>
                    {block.table.headers.map((header, columnIndex) => (
                      <th
                        className={`markdownTableAlign-${block.table.alignments[columnIndex]}`}
                        key={columnIndex}
                        scope="col"
                      >
                        {renderInlineMarkdown(header)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.table.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, columnIndex) => (
                        <td
                          className={`markdownTableAlign-${block.table.alignments[columnIndex]}`}
                          key={columnIndex}
                        >
                          {renderInlineMarkdown(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }

        if (block.type === 'code') {
          return (
            <pre key={index}>
              {block.language ? <span className="codeLanguage">{block.language}</span> : null}
              <code>{block.content}</code>
            </pre>
          )
        }

        return <p key={index}>{renderInlineMarkdown(block.text)}</p>
      })}
    </div>
  )
}
