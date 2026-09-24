import { describe, expect, it } from 'vitest'
import { extractNoteTags } from './note-tags'

describe('Note tags', () => {
  it('extracts unique Chinese, English and nested tags', () => {
    expect(extractNoteTags('#短语 #解释含义 #word/usage #短语')).toEqual([
      '短语', '解释含义', 'word/usage'
    ])
  })

  it('excludes headings, escaped hashes, URLs, code and plain body text', () => {
    expect(extractNoteTags('# Heading\n普通正文\n`#code`\n```md\n#hidden\n```\n[link](https://example.com/#anchor)\n\\#escaped word#fragment\n#可见')).toEqual(['可见'])
  })
})
