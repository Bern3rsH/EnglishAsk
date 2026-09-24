import { parser, GFM } from '@lezer/markdown'

const tagParser = parser.configure(GFM)
const TAG_PATTERN = /(?<![\p{L}\p{N}_/#\\])#[\p{L}\p{N}_][\p{L}\p{N}_/-]*/gu
const EXCLUDED_NODES = new Set([
  'InlineCode', 'FencedCode', 'CodeBlock', 'Link', 'Autolink', 'Image',
  'URL', 'HTMLBlock', 'HTMLTag', 'CommentBlock'
])

export const extractNoteTags = (markdown: string): string[] => {
  const tree = tagParser.parse(markdown)
  const tags = new Set<string>()
  for (const match of markdown.matchAll(TAG_PATTERN)) {
    let node = tree.resolveInner(match.index, 1)
    let excluded = false
    while (node) {
      if (EXCLUDED_NODES.has(node.name)) {
        excluded = true
        break
      }
      if (!node.parent) break
      node = node.parent
    }
    if (!excluded) tags.add(match[0].slice(1))
  }
  return [...tags]
}
