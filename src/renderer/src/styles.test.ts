import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesPath = fileURLToPath(new URL('./styles.css', import.meta.url))

describe('Asks and Notes 列表 styles', () => {
  it('keeps the provider panel anchored independently of submenu content and loading', async () => {
    const styles = await readFile(stylesPath, 'utf8')
    expect(styles).toMatch(/\.composerProviderMenu\s*{[^}]*align-self:\s*end;[^}]*max-height:\s*100%/s)
    expect(styles).toMatch(/\.composerModelSubmenu\s*{[^}]*height:\s*100%/s)
    expect(styles).toMatch(/\.composerProviderMenu,\s*\.composerModelSubmenu\s*{[^}]*overflow-y:\s*auto/s)
    expect(styles).not.toContain('.composerModelMenu:not(:has(.composerModelSubmenu))')
  })
  it('gives the EnglishAsk brand stronger type and vertical spacing', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toMatch(/\.sidebarHeader\s*{[^}]*margin:\s*10px 0 18px;/s)
    expect(styles).toMatch(/\.sidebarBrand strong\s*{[^}]*font-size:\s*1\.22rem;/s)
  })

  it('use the same constrained column layout and complete rounded item surfaces', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toMatch(
      /\.asksListPanel,\s*\.notesListPanel\s*{[^}]*position:\s*relative;[^}]*overflow-x:\s*hidden;[^}]*overscroll-behavior-x:\s*none;/s
    )
    expect(styles).toMatch(
      /\.asksListPanel \.historyList,\s*\.notesListPanel \.historyList\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*min-width:\s*0;[^}]*padding-inline:\s*4px;[^}]*overflow-x:\s*hidden;/s
    )
    expect(styles).toMatch(
      /\.asksListPanel \.historyItem,\s*\.asksListPanel \.historyRenameForm,\s*\.notesListPanel \.historyItem,\s*\.notesListPanel \.historyRenameForm\s*{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s
    )
    expect(styles).toMatch(
      /\.historyItem\s*{[^}]*border-radius:\s*8px;/s
    )
  })

  it('share a persisted-width grid track and resize handle styling', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toMatch(/:root\s*{[^}]*--primary-sidebar-width:\s*156px;/s)
    expect(styles).toMatch(
      /\.appShell\s*{[^}]*grid-template-columns:\s*var\(--primary-sidebar-width\) var\(--list-panel-width,\s*292px\) minmax\(0,\s*1fr\);/s
    )
    expect(styles).toMatch(
      /\.settingsShell\s*{[^}]*grid-template-columns:\s*var\(--primary-sidebar-width\) minmax\(0,\s*1fr\);/s
    )
    expect(styles).toMatch(
      /\.listPanelResizeHandle\s*{[^}]*right:\s*0;[^}]*width:\s*8px;[^}]*cursor:\s*col-resize;/s
    )
    expect(styles).toMatch(
      /\.listPanelResizeHandle:hover::after,\s*\.listPanelResizeHandle:focus-visible::after,\s*\.listPanelResizeHandle-active::after\s*{[^}]*background:\s*#73757b;/s
    )
  })

  it('keeps primary navigation typography and spacing aligned with settings navigation', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toMatch(
      /\.sidebarNavItem,\s*\.settingsBackButton,\s*\.settingsSidebarItem\s*{[^}]*min-height:\s*42px;[^}]*padding:\s*0 12px;[^}]*font-size:\s*1rem;[^}]*font-weight:\s*750;[^}]*line-height:\s*1\.2;/s
    )
    expect(styles).toMatch(
      /\.sidebarNav\s*{[^}]*gap:\s*4px;/s
    )
    expect(styles).toMatch(
      /\.settingsSidebarNav\s*{[^}]*gap:\s*4px;/s
    )
  })

  it('keeps navigation hover backgrounds unchanged while highlighting active items', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).not.toMatch(/\.sidebarNavItem:hover\s*{/)
    expect(styles).not.toMatch(/\.settingsBackButton:hover\s*[,\{]/)
    expect(styles).not.toMatch(/\.settingsSidebarItem:hover\s*[,\{]/)
    expect(styles).toMatch(/\.sidebarNavItem-active\s*{[^}]*background:\s*#242424;/s)
    expect(styles).toMatch(/\.settingsSidebarItem-active\s*{[^}]*background:\s*#242424;/s)
  })

  it('use matching dark thin scrollbars instead of the native light track', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toMatch(
      /\.asksListPanel \.historyList,\s*\.notesListPanel \.historyList\s*{[^}]*scrollbar-color:\s*#5f6064 transparent;[^}]*scrollbar-width:\s*thin;/s
    )
    expect(styles).toMatch(
      /\.asksListPanel \.historyList::-(?:webkit|Webkit)-scrollbar-track,\s*\.notesListPanel \.historyList::-(?:webkit|Webkit)-scrollbar-track\s*{[^}]*background:\s*transparent;/s
    )
    expect(styles).toMatch(
      /\.asksListPanel \.historyList::-(?:webkit|Webkit)-scrollbar-thumb,\s*\.notesListPanel \.historyList::-(?:webkit|Webkit)-scrollbar-thumb\s*{[^}]*border:\s*2px solid #191919;[^}]*background:\s*#5f6064;/s
    )
  })
})

describe('conversation styles', () => {
  it('keeps answer bottom spacing equal to the compact top spacing', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toMatch(
      /\.conversation\s*{[^}]*padding:\s*28px var\(--ask-content-inline-padding\);/s
    )
  })

  it('preserves line breaks between an example and its translation inside a list item', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toMatch(/\.markdownContent p,\s*\.markdownContent li,\s*\.markdownContent blockquote\s*{[^}]*white-space:\s*pre-wrap;/s)
  })

  it('keeps the ask composer compact while retaining a multiline input', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toMatch(
      /\.composerSurface\s*{[^}]*gap:\s*8px;[^}]*min-height:\s*118px;[^}]*padding:\s*16px 18px 14px;/s
    )
    expect(styles).toMatch(/\.composer textarea\s*{[^}]*min-height:\s*54px;/s)
  })

  it('aligns composer text with the model name without an extra left inset', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toMatch(/\.composer textarea\s*{[^}]*padding:\s*0 6px 0 0;/s)
    expect(styles).toMatch(/\.composer textarea\s*{[^}]*border:\s*0;/s)
    expect(styles).not.toMatch(/\.composerActions\s*{[^}]*(?:padding|margin)(?:-left|-inline-start)?:/s)
    expect(styles).not.toMatch(/\.composerModelName\s*{[^}]*(?:padding|margin)(?:-left|-inline-start)?:/s)
  })

  it('uses a neutral cursor for the disabled 发送 button after stopping', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toMatch(/\.composer button:disabled\s*{[^}]*cursor:\s*default;/s)
    expect(styles).not.toMatch(/\.composer button:disabled\s*{[^}]*cursor:\s*wait;/s)
  })

  it('keeps programmatic Ask restoration instant instead of globally smoothing scroll', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toMatch(/\.conversation\s*{[^}]*overflow-y:\s*auto;/s)
    expect(styles).not.toMatch(/\.conversation\s*{[^}]*scroll-behavior:\s*smooth;/s)
  })

  it('uses a gray thin scrollbar instead of the native light scrollbar', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toMatch(
      /\.conversation\s*{[^}]*scrollbar-color:\s*#5f6064 transparent;[^}]*scrollbar-width:\s*thin;/s
    )
    expect(styles).toMatch(
      /\.conversation::-(?:webkit|Webkit)-scrollbar-track\s*{[^}]*background:\s*transparent;/s
    )
    expect(styles).toMatch(
      /\.conversation::-(?:webkit|Webkit)-scrollbar-thumb\s*{[^}]*border:\s*2px solid #212121;[^}]*background:\s*#5f6064;/s
    )
  })

  it('keeps 分类器 diagnostics visually separate and readable after an answer', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toMatch(
      /\.routerDiagnostic\s*{[^}]*margin-top:\s*18px;[^}]*border-left:\s*3px solid #50a684;[^}]*border-radius:\s*6px;/s
    )
    expect(styles).toMatch(
      /\.routerDiagnosticDetails > div\s*{[^}]*grid-template-columns:\s*84px minmax\(0,\s*1fr\);/s
    )
    expect(styles).toMatch(
      /\.routerDiagnosticHeader code\s*{[^}]*overflow-wrap:\s*anywhere;/s
    )
  })

  it('renders Ask answers with normal Markdown styling instead of knowledge-card chrome', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toMatch(
      /\.markdownContent\s*{[^}]*font-size:\s*0\.98rem;[^}]*line-height:\s*1\.65;/s
    )
    expect(styles).toMatch(
      /\.markdownContent h1,\s*\.markdownContent h2,\s*\.markdownContent h3\s*{[^}]*margin:\s*0\.95em 0 0\.45em;[^}]*color:\s*#f2f2f2;[^}]*line-height:\s*1\.2;/s
    )
    expect(styles).toMatch(
      /\.markdownTableWrapper\s*{[^}]*width:\s*100%;[^}]*overflow-x:\s*auto;[^}]*border:\s*1px solid #42474e;[^}]*border-radius:\s*6px;/s
    )
    expect(styles).toMatch(
      /\.markdownTableWrapper th,\s*\.markdownTableWrapper td\s*{[^}]*min-width:\s*120px;[^}]*padding:\s*9px 12px;[^}]*border-right:\s*1px solid #3b4046;[^}]*border-bottom:\s*1px solid #3b4046;/s
    )
    expect(styles).not.toContain('.knowledgeCard')
    expect(styles).not.toContain('.knowledgeCardSections')
    expect(styles).not.toContain('.routerDiagnosticActions')
    expect(styles).not.toContain('.knowledgeCardGenerationError')
  })
})
