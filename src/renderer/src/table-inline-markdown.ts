import { GFM, parser } from '@lezer/markdown'

const inlineParser = parser.configure(GFM)
type SyntaxNode = ReturnType<typeof inlineParser.parse>['topNode']
const inlineTags: Record<string, string> = {
  StrongEmphasis: 'strong', Emphasis: 'em', Strikethrough: 'del', InlineCode: 'code'
}

export const appendTableCellMarkdown = (parent: HTMLElement, source: string): void => {
  const document = parent.ownerDocument
  const appendContents = (container: HTMLElement, node: SyntaxNode, from = node.from, to = node.to): void => {
    let position = from
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.from < from || child.to > to) continue
      container.append(document.createTextNode(source.slice(position, child.from)))
      appendNode(container, child)
      position = child.to
    }
    container.append(document.createTextNode(source.slice(position, to)))
  }
  const appendNode = (container: HTMLElement, node: SyntaxNode): void => {
    const tag = inlineTags[node.name]
    if (tag && node.firstChild && node.lastChild) {
      const element = document.createElement(tag)
      if (node.name === 'InlineCode') {
        const content = source.slice(node.firstChild.to, node.lastChild.from).replace(/\n/g, ' ')
        element.textContent = /^ .* $/.test(content) && /\S/.test(content) ? content.slice(1, -1) : content
      } else appendContents(element, node, node.firstChild.to, node.lastChild.from)
      container.append(element)
    } else if (node.name === 'Link') {
      const closingLabel = node.getChildren('LinkMark').find(mark => source.slice(mark.from, mark.to) === ']')
      const url = node.getChild('URL')
      const href = url ? source.slice(url.from, url.to) : ''
      const safe = /^(https?:\/\/|mailto:)/i.test(href)
      const element = document.createElement(safe ? 'a' : 'span')
      if (safe) {
        element.setAttribute('href', href)
        element.setAttribute('rel', 'noreferrer noopener')
        element.setAttribute('target', '_blank')
      }
      if (node.firstChild && closingLabel) appendContents(element, node, node.firstChild.to, closingLabel.from)
      else element.textContent = source.slice(node.from, node.to)
      container.append(element)
    } else if (node.name === 'Document' || node.name === 'Paragraph') {
      appendContents(container, node)
    } else {
      // Raw HTML, images and unsupported syntax remain inert text, never executable markup.
      container.append(document.createTextNode(source.slice(node.from + (node.name === 'Escape' ? 1 : 0), node.to)))
    }
  }
  appendNode(parent, inlineParser.parse(source).topNode)
}
