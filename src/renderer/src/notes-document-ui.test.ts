import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appSourcePath = fileURLToPath(new URL('./App.tsx', import.meta.url))
const stylesPath = fileURLToPath(new URL('./styles.css', import.meta.url))

describe('Notes document layout', () => {
  it('presents the file name as the document level-one heading', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain(
      '<div aria-level={1} className="noteDocumentTitle" role="heading">'
    )
    expect(appSource).toContain('aria-label="当前 Note 标题"')
    expect(appSource).toContain('className="noteTitleInput"')
    expect(appSource).toContain('onFocus={startEditingActiveNoteTitle}')
    expect(appSource).not.toContain('className="noteTitleButton"')
    expect(appSource).not.toContain('className="noteTitleRenameForm"')
    expect(appSource).toContain(
      '<div className="notesBodyFocusArea" onClick={handleNotesBodyClick}>'
    )
    expect(appSource).toContain('ref={noteEditorRef}')
    expect(appSource).toContain('<LiveMarkdownEditor')
    expect(appSource).toContain('key={activeNoteId}')
    expect(appSource).toContain('onUploadImage={uploadNoteImage}')
    expect(appSource).not.toContain('aria-label="Note editor mode"')
    expect(appSource).not.toContain('<MDXEditor')
    expect(appSource).toContain('}, NOTE_AUTOSAVE_DELAY_MS)')
    expect(appSource).toContain('onBlur={handleActiveNoteTitleBlur}')
    expect(appSource).not.toContain('noteSaveStatus')
    expect(appSource).not.toContain("noteSaveStatus === 'saving'")
  })

  it('renders the empty Notes 工作区 as a plain black surface', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')
    const styles = await readFile(stylesPath, 'utf8')

    expect(appSource).toContain(
      "className={`workspace notesWorkspace${activeNoteId ? '' : ' notesWorkspace-empty'}`}"
    )
    expect(appSource).toContain('{activeNoteId ? (')
    expect(appSource).not.toContain('className="notesEmptyState"')
    expect(appSource).not.toContain('Create a note to start writing.')
    expect(styles).toMatch(
      /\.notesWorkspace-empty\s*{[^}]*padding:\s*0;[^}]*background:\s*#000;/s
    )
    expect(styles).not.toContain('.notesEmptyState')
  })

  it('uses heading scale for the file name and a separate rounded Markdown surface', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toMatch(
      /\.notesEditorShell\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s
    )
    expect(styles).toMatch(
      /\.noteDocumentTitle\s*{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s
    )
    expect(styles).toMatch(
      /\.notesWorkspace\s*{[^}]*--notes-heading-one-font-size:\s*1\.75rem;/s
    )
    expect(styles).toMatch(
      /\.notesWorkspace\s*{[^}]*--notes-workspace-top-padding:\s*clamp\(16px,\s*3vw,\s*28px\);[^}]*padding:\s*var\(--notes-workspace-top-padding\)\s*0\s*0\s*var\(--notes-workspace-inline-padding\);/s
    )
    expect(styles).not.toContain('--notes-workspace-bottom-padding')
    expect(styles).toMatch(
      /\.noteTitleInput\s*{[^}]*field-sizing:\s*content;[^}]*max-width:\s*100%;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*font-size:\s*var\(--notes-heading-one-font-size\);[^}]*font-weight:\s*850;[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*pre-wrap;/s
    )
    expect(styles).not.toContain('.noteTitleInput:hover')
    expect(styles).not.toContain('.noteTitleInput:focus')
    expect(styles).toMatch(
      /\.notesBodyFocusArea\s*{[^}]*min-height:\s*0;[^}]*padding-top:\s*24px;[^}]*cursor:\s*text;/s
    )
    expect(styles).toMatch(
      /\.notesLiveMarkdownEditor \.cm-content\s*{[^}]*min-height:\s*100%;[^}]*padding:\s*12px\s*calc\(var\(--notes-workspace-inline-padding\) \+ 8px\)\s*var\(--notes-editor-bottom-padding\)\s*8px;/s
    )
    expect(styles).toMatch(
      /\.notesWorkspace\s*{[^}]*--notes-editor-bottom-padding:\s*clamp\(56px,\s*10vh,\s*96px\);/s
    )
    expect(styles).toMatch(
      /\.notesLiveMarkdownEditor \.cm-scroller\s*{[^}]*scrollbar-color:\s*#73777e transparent;[^}]*scrollbar-gutter:\s*stable;/s
    )
    expect(styles).toMatch(
      /\.notesLiveMarkdownEditor \.cm-scroller::-(?:webkit|Webkit)-scrollbar-thumb\s*{[^}]*background:\s*#73777e;/s
    )
    expect(styles).toMatch(
      /\.notesLiveMarkdownEditor \.cm-live-heading-1\s*{[^}]*font-size:\s*var\(--notes-heading-one-font-size\);/s
    )
    expect(styles).toMatch(
      /\.notesLiveMarkdownEditor \.cm-live-inline-code\s*{[^}]*background:\s*#2b2d31;[^}]*font-family:\s*"SFMono-Regular"/s
    )
    expect(styles).toMatch(
      /\.notesLiveMarkdownEditor \.cm-activeLine\s*{[^}]*background:\s*#2a3036;/s
    )
    expect(styles).not.toContain('.noteEditorModeControl')
    expect(styles).not.toContain('.notesLiveMarkdownContent')
  })
})
