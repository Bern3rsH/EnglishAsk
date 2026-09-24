import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { describe, expect, it, vi } from 'vitest'
import {
  buildLivePreviewRanges,
  parseMarkdownTable,
  revealMarkdownTableForEditing
} from './live-markdown-editor'

const createMarkdownState = (document: string): EditorState =>
  EditorState.create({
    doc: document,
    extensions: [markdown({ extensions: GFM })]
  })

describe('Markdown live preview', () => {
  it('renders Chinese and English hashtags as chips while preserving source text', () => {
    const source = '#短语 #解释含义 #word/usage\nPlain text'
    const state = createMarkdownState(source)
    const tags = buildLivePreviewRanges(state, 2).filter((range) => range.className === 'cm-live-tag')
    expect(tags.map((range) => state.doc.sliceString(range.from, range.to))).toEqual([
      '#短语', '#解释含义', '#word/usage'
    ])
    expect(state.doc.toString()).toBe(source)
    expect(buildLivePreviewRanges(state, 1).some((range) => range.className === 'cm-live-tag')).toBe(false)
  })

  it('does not decorate heading markers, code, links, escaped hashes or word fragments', () => {
    const source = '# Heading\n`#code`\n```md\n#fenced\n```\n[link](https://example.com/#anchor)\n\\#escaped word#fragment\n#短语'
    const state = createMarkdownState(source)
    const tags = buildLivePreviewRanges(state, null).filter((range) => range.className === 'cm-live-tag')
    expect(tags.map((range) => state.doc.sliceString(range.from, range.to))).toEqual(['#短语'])
  })

  it('hides heading markers outside the focused line and keeps the heading style', () => {
    const state = createMarkdownState('### Heading\nPlain text')
    const previewRanges = buildLivePreviewRanges(state, 2)

    expect(previewRanges).toContainEqual({
      className: 'cm-live-heading-3',
      from: 0,
      kind: 'line',
      to: 0
    })
    expect(previewRanges).toContainEqual({ from: 0, kind: 'hide', to: 4 })
  })

  it('reveals the raw Markdown markers on the focused line', () => {
    const state = createMarkdownState('### Heading\n**Strong** and `code`')
    const focusedHeadingRanges = buildLivePreviewRanges(state, 1)
    const focusedInlineRanges = buildLivePreviewRanges(state, 2)

    expect(focusedHeadingRanges).not.toContainEqual({ from: 0, kind: 'hide', to: 4 })
    expect(
      focusedInlineRanges.some((range) => range.kind === 'hide' && range.from >= 12)
    ).toBe(false)
  })

  it('renders images and list markers while preserving their source ranges', () => {
    const state = createMarkdownState('- item\n![diagram](assets/diagram.png)')
    const previewRanges = buildLivePreviewRanges(state, null)

    expect(previewRanges).toContainEqual({
      from: 0,
      kind: 'marker',
      label: '-',
      to: 2
    })
    expect(previewRanges).toContainEqual({
      from: 7,
      kind: 'image',
      label: 'diagram',
      source: 'assets/diagram.png',
      to: 37
    })
  })

  it('renders GFM tables outside the focused table and preserves column alignment', () => {
    const document =
      '| Term | Meaning |\n| :--- | ---: |\n| cold turkey | stop immediately |'
    const state = createMarkdownState(document)
    const previewRanges = buildLivePreviewRanges(state, null)

    expect(previewRanges).toContainEqual({
      from: 0,
      kind: 'table',
      source: document,
      table: {
        alignments: ['left', 'right'],
        headers: ['Term', 'Meaning'],
        rows: [['cold turkey', 'stop immediately']]
      },
      to: document.length
    })
    expect(buildLivePreviewRanges(state, 2).some((range) => range.kind === 'table')).toBe(
      false
    )
  })

  it('keeps escaped pipes and code pipes inside their table cells', () => {
    expect(
      parseMarkdownTable('| Pattern | Result |\n| --- | --- |\n| a\\|b | `x|y` |')
    ).toEqual({
      alignments: ['left', 'left'],
      headers: ['Pattern', 'Result'],
      rows: [['a|b', '`x|y`']]
    })
  })

  it('moves the editor selection into a preview table before focusing it', () => {
    const dispatch = vi.fn()
    const focus = vi.fn()
    const editorView = { dispatch, focus } as unknown as EditorView

    revealMarkdownTableForEditing(editorView, 24)

    expect(dispatch).toHaveBeenCalledWith({
      scrollIntoView: true,
      selection: { anchor: 24 }
    })
    expect(focus).toHaveBeenCalledOnce()
  })
})
