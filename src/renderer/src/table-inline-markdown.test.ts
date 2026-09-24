// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { appendTableCellMarkdown } from './table-inline-markdown'
import { parseMarkdownTable, TablePreviewWidget } from './live-markdown-editor'

it('renders nested emphasis, strike and code without showing delimiters', () => {
  const cell = document.createElement('td')
  appendTableCellMarkdown(cell, '**say *to* `someone`** and ~~old~~')
  expect(cell.innerHTML).toBe('<strong>say <em>to</em> <code>someone</code></strong> and <del>old</del>')
})

it('keeps code literal and preserves unmatched syntax', () => {
  const cell = document.createElement('td')
  appendTableCellMarkdown(cell, '`**literal**` and **unfinished')
  expect(cell.querySelector('code')?.textContent).toBe('**literal**')
  expect(cell.querySelector('strong')).toBeNull()
  expect(cell.textContent).toContain('**unfinished')
})

it('does not execute raw HTML or unsafe links', () => {
  const cell = document.createElement('td')
  appendTableCellMarkdown(cell, '<img src=x onerror=alert(1)> [bad](javascript:alert) [good](https://example.com)')
  expect(cell.querySelector('img')).toBeNull()
  expect(cell.querySelectorAll('a')).toHaveLength(1)
  expect(cell.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
  expect(cell.textContent).toContain('<img src=x onerror=alert(1)>')
})

it('renders table headers/cells and still reveals the original source on click', () => {
  const source = '| **Form** | Meaning |\n| :--- | ---: |\n| say **to** | `a|b` |'
  const dispatch = vi.fn()
  const focus = vi.fn()
  const view = { dispatch, focus } as unknown as EditorView
  const widget = new TablePreviewWidget(12, source, parseMarkdownTable(source)!)
  const element = widget.toDOM(view)
  expect(element.querySelector('th strong')?.textContent).toBe('Form')
  expect(element.querySelector('td strong')?.textContent).toBe('to')
  expect(element.querySelector('td code')?.textContent).toBe('a|b')
  expect(element.querySelectorAll('td')[1].className).toBe('cm-live-table-align-right')
  element.querySelector('td strong')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  expect(dispatch).toHaveBeenCalledWith({ scrollIntoView: true, selection: { anchor: 12 } })
  expect(focus).toHaveBeenCalledOnce()
  expect(source).toContain('say **to**')
})

it('does not navigate away from the editor when a preview link is clicked', () => {
  const source = '| Link |\n| --- |\n| [site](https://example.com) |'
  const widget = new TablePreviewWidget(0, source, parseMarkdownTable(source)!)
  const element = widget.toDOM({} as EditorView)
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  element.querySelector('a')!.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
})
