import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownContent, parseMarkdownBlocks } from './markdown'

describe('markdown helpers', () => {
  it('parses common answer markdown blocks', () => {
    const blocks = parseMarkdownBlocks(`# Title

Intro paragraph with **bold** and \`code\`.

- First item
- Second item

1. Ordered first
2. Ordered second

> Quoted idea
> Continued quote

\`\`\`ts
const answer = 'rendered'
\`\`\``)

    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'paragraph', text: 'Intro paragraph with **bold** and `code`.' },
      { type: 'unordered-list', items: ['First item', 'Second item'] },
      { type: 'ordered-list', items: ['Ordered first', 'Ordered second'] },
      { type: 'blockquote', text: 'Quoted idea\nContinued quote' },
      { type: 'code', language: 'ts', content: "const answer = 'rendered'" }
    ])
  })

  it('keeps multiline paragraphs together and skips empty input', () => {
    expect(parseMarkdownBlocks('')).toEqual([])
    expect(parseMarkdownBlocks('First line\nsecond line')).toEqual([
      { type: 'paragraph', text: 'First line\nsecond line' }
    ])
  })

  it.each(['', '   '])('keeps example translations inside one numbered list with indent %j', (indent) => {
    const content = `1. First English example.\n${indent}第一句翻译。\n\n2. Second English example.\n${indent}第二句翻译。`

    expect(parseMarkdownBlocks(content)).toEqual([
      {
        type: 'ordered-list',
        items: ['First English example.\n第一句翻译。', 'Second English example.\n第二句翻译。']
      }
    ])
    const html = renderToStaticMarkup(createElement(MarkdownContent, { content }))
    expect(html.match(/<ol\b/g)).toHaveLength(1)
    expect(html.match(/<li\b/g)).toHaveLength(2)
  })

  it('preserves the start number when translations genuinely separate two lists', () => {
    const content = '1. First example.\n\n第一句翻译。\n\n2. Second example.\n\n第二句翻译。'

    expect(parseMarkdownBlocks(content)).toEqual([
      { type: 'ordered-list', items: ['First example.'] },
      { type: 'paragraph', text: '第一句翻译。' },
      { type: 'ordered-list', items: ['Second example.'], start: 2 },
      { type: 'paragraph', text: '第二句翻译。' }
    ])
    expect(renderToStaticMarkup(createElement(MarkdownContent, { content }))).toContain(
      '<ol start="2"><li>Second example.</li></ol>'
    )
  })

  it('recognizes indented lists with Windows line endings', () => {
    expect(parseMarkdownBlocks('  2. First.\r\n     翻译。\r\n  3. Second.')).toEqual([
      { type: 'ordered-list', items: ['First.\n翻译。', 'Second.'], start: 2 }
    ])
  })

  it('keeps loose bullet translations and repeated Markdown numbering in their lists', () => {
    expect(parseMarkdownBlocks('- First.\n\n  翻译。\n\n- Second.\n  翻译二。')).toEqual([
      { type: 'unordered-list', items: ['First.\n\n翻译。', 'Second.\n翻译二。'] }
    ])
    expect(parseMarkdownBlocks('1. First.\n   翻译。\n1. Second.\n   翻译二。')).toEqual([
      { type: 'ordered-list', items: ['First.\n翻译。', 'Second.\n翻译二。'] }
    ])
  })

  it('does not merge lists across headings or treat code and oversized markers as list items', () => {
    expect(parseMarkdownBlocks('1. First.\n\n## Next topic\n\n1. New list.')).toEqual([
      { type: 'ordered-list', items: ['First.'] },
      { type: 'heading', level: 2, text: 'Next topic' },
      { type: 'ordered-list', items: ['New list.'] }
    ])
    expect(parseMarkdownBlocks('```text\n1. Code line\n```\n\n1234567890. Not a list.')).toEqual([
      { type: 'code', language: 'text', content: '1. Code line' },
      { type: 'paragraph', text: '1234567890. Not a list.' }
    ])
  })

  it('parses GFM tables with alignment, escaped pipes, and following content', () => {
    expect(
      parseMarkdownBlocks(`| Pattern | Meaning | Example |
| :--- | :---: | ---: |
| a\\|b | **literal pipe** | \`x|y\` |

After the table.`)
    ).toEqual([
      {
        type: 'table',
        table: {
          alignments: ['left', 'center', 'right'],
          headers: ['Pattern', 'Meaning', 'Example'],
          rows: [['a|b', '**literal pipe**', '`x|y`']]
        }
      },
      { type: 'paragraph', text: 'After the table.' }
    ])
  })

  it('keeps invalid table-like Markdown as a paragraph', () => {
    expect(parseMarkdownBlocks('| Term | Meaning |\n| short | -- |')).toEqual([
      { type: 'paragraph', text: '| Term | Meaning |\n| short | -- |' }
    ])
  })
})
