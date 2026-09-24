import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownKeymap } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import {
  Annotation,
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Range
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  keymap,
  type DecorationSet
} from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactElement
} from 'react'
import { parseMarkdownTable, type MarkdownTablePreview } from './markdown-table'
import { appendTableCellMarkdown } from './table-inline-markdown'

export { parseMarkdownTable } from './markdown-table'

const externalDocumentUpdate = Annotation.define<boolean>()
const setEditorFocused = StateEffect.define<boolean>()
const NOTE_TAG_PATTERN = /(?<![\p{L}\p{N}_/#\\])#[\p{L}\p{N}_][\p{L}\p{N}_/-]*/gu
const TAG_EXCLUDED_NODES = new Set([
  'InlineCode', 'FencedCode', 'CodeBlock', 'Link', 'Autolink', 'Image',
  'URL', 'HTMLBlock', 'HTMLTag', 'CommentBlock', 'Table'
])

type LivePreviewRangeKind =
  | 'hide'
  | 'image'
  | 'line'
  | 'mark'
  | 'marker'
  | 'rule'
  | 'table'
  | 'task'

export type LivePreviewRange = {
  className?: string
  from: number
  kind: LivePreviewRangeKind
  label?: string
  source?: string
  table?: MarkdownTablePreview
  to: number
}

export type LiveMarkdownEditorHandle = {
  focus: () => void
}

type LiveMarkdownEditorProps = {
  disabled?: boolean
  markdown: string
  onChange: (markdown: string) => void
  onUploadImage: (image: File) => Promise<string>
}

const getMarkerEnd = (state: EditorState, markerEnd: number): number => {
  if (markerEnd < state.doc.length && /[ \t]/.test(state.doc.sliceString(markerEnd, markerEnd + 1))) {
    return markerEnd + 1
  }

  return markerEnd
}

const getImageDetails = (source: string): { alt: string; source: string } | null => {
  const match = source.match(/^!\[([^\]]*)\]\((\S+?)(?:\s+["'].*["'])?\)$/)

  return match ? { alt: match[1], source: match[2] } : null
}

export const revealMarkdownTableForEditing = (
  editorView: EditorView,
  tableStart: number
): void => {
  editorView.dispatch({
    scrollIntoView: true,
    selection: { anchor: tableStart }
  })
  editorView.focus()
}

export const buildLivePreviewRanges = (
  state: EditorState,
  revealedLineNumber: number | null
): LivePreviewRange[] => {
  const ranges: LivePreviewRange[] = []

  syntaxTree(state).iterate({
    enter(node) {
      const line = state.doc.lineAt(node.from)
      const markerIsRevealed = revealedLineNumber === line.number

      if (node.name === 'Table') {
        const lastTableLine = state.doc.lineAt(Math.max(node.from, node.to - 1)).number
        const tableIsRevealed =
          revealedLineNumber !== null &&
          revealedLineNumber >= line.number &&
          revealedLineNumber <= lastTableLine

        if (tableIsRevealed) {
          return false
        }

        const source = state.doc.sliceString(node.from, node.to)
        const table = parseMarkdownTable(source)

        if (table) {
          ranges.push({ from: node.from, kind: 'table', source, table, to: node.to })
          return false
        }
      }

      if (/^ATXHeading[1-6]$/.test(node.name)) {
        ranges.push({
          className: `cm-live-heading-${node.name.at(-1)}`,
          from: line.from,
          kind: 'line',
          to: line.from
        })
      }

      if (node.name === 'StrongEmphasis') {
        ranges.push({ className: 'cm-live-strong', from: node.from, kind: 'mark', to: node.to })
      } else if (node.name === 'Emphasis') {
        ranges.push({ className: 'cm-live-emphasis', from: node.from, kind: 'mark', to: node.to })
      } else if (node.name === 'Strikethrough') {
        ranges.push({ className: 'cm-live-strikethrough', from: node.from, kind: 'mark', to: node.to })
      } else if (node.name === 'InlineCode') {
        ranges.push({ className: 'cm-live-inline-code', from: node.from, kind: 'mark', to: node.to })
      } else if (node.name === 'Link') {
        ranges.push({ className: 'cm-live-link', from: node.from, kind: 'mark', to: node.to })
      } else if (node.name === 'CodeText') {
        ranges.push({ className: 'cm-live-code-block', from: node.from, kind: 'mark', to: node.to })
      }

      if (markerIsRevealed) {
        return
      }

      if (node.name === 'Image') {
        const details = getImageDetails(state.doc.sliceString(node.from, node.to))

        if (details) {
          ranges.push({
            from: node.from,
            kind: 'image',
            label: details.alt,
            source: details.source,
            to: node.to
          })
          return false
        }
      }

      if (node.name === 'HorizontalRule') {
        ranges.push({ from: node.from, kind: 'rule', to: node.to })
        return false
      }

      if (node.name === 'ListMark') {
        ranges.push({
          from: node.from,
          kind: 'marker',
          label: state.doc.sliceString(node.from, node.to),
          to: getMarkerEnd(state, node.to)
        })
      } else if (node.name === 'TaskMarker') {
        ranges.push({
          className: /x/i.test(state.doc.sliceString(node.from, node.to))
            ? 'cm-live-task-checked'
            : '',
          from: node.from,
          kind: 'task',
          to: getMarkerEnd(state, node.to)
        })
      } else if (node.name === 'QuoteMark') {
        ranges.push({
          className: 'cm-live-blockquote',
          from: line.from,
          kind: 'line',
          to: line.from
        })
        ranges.push({ from: node.from, kind: 'hide', to: getMarkerEnd(state, node.to) })
      } else if (node.name === 'HeaderMark') {
        ranges.push({ from: node.from, kind: 'hide', to: getMarkerEnd(state, node.to) })
      } else if (
        node.name === 'EmphasisMark' ||
        node.name === 'StrikethroughMark' ||
        node.name === 'CodeMark' ||
        node.name === 'CodeInfo' ||
        node.name === 'LinkMark' ||
        node.name === 'URL'
      ) {
        ranges.push({ from: node.from, kind: 'hide', to: node.to })
      }
    }
  })

  const tree = syntaxTree(state)
  for (const match of state.doc.toString().matchAll(NOTE_TAG_PATTERN)) {
    const from = match.index
    const to = from + match[0].length
    if (state.doc.lineAt(from).number === revealedLineNumber) {
      continue
    }

    let node = tree.resolveInner(from, 1)
    let isExcluded = false
    while (node) {
      if (TAG_EXCLUDED_NODES.has(node.name)) {
        isExcluded = true
        break
      }
      if (!node.parent) break
      node = node.parent
    }

    if (!isExcluded) {
      ranges.push({ className: 'cm-live-tag', from, kind: 'mark', to })
    }
  }

  return ranges
}

class ImagePreviewWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly label: string
  ) {
    super()
  }

  eq(other: ImagePreviewWidget): boolean {
    return other.source === this.source && other.label === this.label
  }

  toDOM(): HTMLElement {
    const image = document.createElement('img')
    image.alt = this.label
    image.className = 'cm-live-image'
    image.src = this.source
    return image
  }
}

class MarkerPreviewWidget extends WidgetType {
  constructor(private readonly marker: string) {
    super()
  }

  eq(other: MarkerPreviewWidget): boolean {
    return other.marker === this.marker
  }

  toDOM(): HTMLElement {
    const marker = document.createElement('span')
    marker.className = 'cm-live-list-marker'
    marker.textContent = /^\d/.test(this.marker) ? this.marker : '•'
    return marker
  }
}

class RulePreviewWidget extends WidgetType {
  toDOM(): HTMLElement {
    const rule = document.createElement('span')
    rule.className = 'cm-live-rule'
    return rule
  }
}

class TaskPreviewWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super()
  }

  eq(other: TaskPreviewWidget): boolean {
    return other.checked === this.checked
  }

  toDOM(): HTMLElement {
    const checkbox = document.createElement('span')
    checkbox.ariaHidden = 'true'
    checkbox.className = this.checked ? 'cm-live-task cm-live-task-checked' : 'cm-live-task'
    return checkbox
  }
}

export class TablePreviewWidget extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly source: string,
    private readonly tablePreview: MarkdownTablePreview
  ) {
    super()
  }

  eq(other: TablePreviewWidget): boolean {
    return other.from === this.from && other.source === this.source
  }

  toDOM(editorView: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    const table = document.createElement('table')
    const tableHead = document.createElement('thead')
    const headingRow = document.createElement('tr')

    wrapper.className = 'cm-live-table-wrapper'
    wrapper.setAttribute('aria-label', '编辑 Markdown 表格')
    wrapper.addEventListener('click', (event) => event.preventDefault())
    wrapper.addEventListener('mousedown', (event) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      revealMarkdownTableForEditing(editorView, this.from)
    })
    table.className = 'cm-live-table'

    this.tablePreview.headers.forEach((header, index) => {
      const heading = document.createElement('th')
      heading.className = `cm-live-table-align-${this.tablePreview.alignments[index]}`
      appendTableCellMarkdown(heading, header)
      headingRow.append(heading)
    })

    tableHead.append(headingRow)
    table.append(tableHead)

    if (this.tablePreview.rows.length > 0) {
      const tableBody = document.createElement('tbody')

      this.tablePreview.rows.forEach((row) => {
        const tableRow = document.createElement('tr')

        row.forEach((cell, index) => {
          const tableCell = document.createElement('td')
          tableCell.className = `cm-live-table-align-${this.tablePreview.alignments[index]}`
          appendTableCellMarkdown(tableCell, cell)
          tableRow.append(tableCell)
        })

        tableBody.append(tableRow)
      })

      table.append(tableBody)
    }

    wrapper.append(table)
    return wrapper
  }
}

const createDecorationSet = (
  state: EditorState,
  revealedLineNumber: number | null
): DecorationSet => {
  const decorations: Range<Decoration>[] = buildLivePreviewRanges(state, revealedLineNumber).map(
    (range) => {
      switch (range.kind) {
        case 'hide':
          return Decoration.replace({}).range(range.from, range.to)
        case 'image':
          return Decoration.replace({
            block: true,
            widget: new ImagePreviewWidget(range.source ?? '', range.label ?? '')
          }).range(range.from, range.to)
        case 'line':
          return Decoration.line({ class: range.className }).range(range.from)
        case 'mark':
          return Decoration.mark({ class: range.className }).range(range.from, range.to)
        case 'marker':
          return Decoration.replace({
            widget: new MarkerPreviewWidget(range.label ?? '-')
          }).range(range.from, range.to)
        case 'rule':
          return Decoration.replace({ block: true, widget: new RulePreviewWidget() }).range(
            range.from,
            range.to
          )
        case 'table':
          return Decoration.replace({
            block: true,
            widget: new TablePreviewWidget(
              range.from,
              range.source ?? '',
              range.table ?? { alignments: [], headers: [], rows: [] }
            )
          }).range(range.from, range.to)
        case 'task':
          return Decoration.replace({
            widget: new TaskPreviewWidget(range.className === 'cm-live-task-checked')
          }).range(range.from, range.to)
      }
    }
  )

  return Decoration.set(decorations, true)
}

type LivePreviewFieldValue = {
  decorations: DecorationSet
  isFocused: boolean
}

const livePreviewField = StateField.define<LivePreviewFieldValue>({
  create(state) {
    return {
      decorations: createDecorationSet(state, null),
      isFocused: false
    }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  update(value, transaction) {
    const focusEffect = transaction.effects.find((effect) => effect.is(setEditorFocused))
    const isFocused = focusEffect?.value ?? value.isFocused
    const shouldRebuild =
      transaction.docChanged || transaction.selection !== undefined || focusEffect !== undefined

    if (!shouldRebuild) {
      return value
    }

    return {
      decorations: createDecorationSet(
        transaction.state,
        isFocused
          ? transaction.state.doc.lineAt(transaction.state.selection.main.head).number
          : null
      ),
      isFocused
    }
  }
})

const escapeMarkdownLabel = (label: string): string => label.replace(/[\[\]\\]/g, '\\$&')

const insertUploadedImages = async (
  view: EditorView,
  files: File[],
  position: number,
  uploadImage: (image: File) => Promise<string>
): Promise<void> => {
  const images = files.filter((file) => file.type.startsWith('image/'))

  if (images.length === 0) {
    return
  }

  const markdownImages = await Promise.all(
    images.map(async (image) => {
      const source = await uploadImage(image)
      const label = escapeMarkdownLabel(image.name.replace(/\.[^.]+$/, '') || 'image')
      return `![${label}](${source})`
    })
  )

  if (!view.dom.isConnected) {
    return
  }

  const insertAt = Math.min(position, view.state.doc.length)
  const before = insertAt > 0 && view.state.doc.sliceString(insertAt - 1, insertAt) !== '\n' ? '\n' : ''
  const insertion = `${before}${markdownImages.join('\n')}\n`

  view.dispatch({
    changes: { from: insertAt, insert: insertion },
    selection: { anchor: insertAt + insertion.length },
    scrollIntoView: true
  })
}

export const LiveMarkdownEditor = forwardRef<
  LiveMarkdownEditorHandle,
  LiveMarkdownEditorProps
>(function LiveMarkdownEditor(
  { disabled = false, markdown: markdownValue, onChange, onUploadImage },
  forwardedRef
): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onUploadImageRef = useRef(onUploadImage)
  const editableCompartmentRef = useRef(new Compartment())

  onChangeRef.current = onChange
  onUploadImageRef.current = onUploadImage

  useImperativeHandle(
    forwardedRef,
    () => ({
      focus: () => editorViewRef.current?.focus()
    }),
    []
  )

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    const editorView = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: markdownValue,
        extensions: [
          markdown({ extensions: GFM }),
          history(),
          drawSelection(),
          dropCursor(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': 'Markdown Note 编辑器',
            'aria-description': 'Markdown 实时预览'
          }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...markdownKeymap]),
          editableCompartmentRef.current.of([
            EditorState.readOnly.of(disabled),
            EditorView.editable.of(!disabled)
          ]),
          livePreviewField,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalDocumentUpdate))) {
              onChangeRef.current(update.state.doc.toString())
            }
          }),
          EditorView.domEventHandlers({
            blur(_event, view) {
              view.dispatch({ effects: setEditorFocused.of(false) })
              return false
            },
            drop(event, view) {
              const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
                file.type.startsWith('image/')
              )

              if (files.length === 0) {
                return false
              }

              event.preventDefault()
              const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
              void insertUploadedImages(
                view,
                files,
                position ?? view.state.selection.main.head,
                onUploadImageRef.current
              ).catch(() => undefined)
              return true
            },
            focus(_event, view) {
              view.dispatch({ effects: setEditorFocused.of(true) })
              return false
            },
            paste(event, view) {
              const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
                file.type.startsWith('image/')
              )

              if (files.length === 0) {
                return false
              }

              event.preventDefault()
              void insertUploadedImages(
                view,
                files,
                view.state.selection.main.head,
                onUploadImageRef.current
              ).catch(() => undefined)
              return true
            }
          })
        ]
      })
    })

    editorViewRef.current = editorView

    return () => {
      editorViewRef.current = null
      editorView.destroy()
    }
  }, [])

  useEffect(() => {
    const editorView = editorViewRef.current

    if (!editorView || editorView.state.doc.toString() === markdownValue) {
      return
    }

    editorView.dispatch({
      annotations: externalDocumentUpdate.of(true),
      changes: { from: 0, to: editorView.state.doc.length, insert: markdownValue }
    })
  }, [markdownValue])

  useEffect(() => {
    const editorView = editorViewRef.current

    if (!editorView) {
      return
    }

    editorView.dispatch({
      effects: editableCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(disabled),
        EditorView.editable.of(!disabled)
      ])
    })
  }, [disabled])

  return <div className="notesLiveMarkdownEditor" ref={containerRef} />
})
