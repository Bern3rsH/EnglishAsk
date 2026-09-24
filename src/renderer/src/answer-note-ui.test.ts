import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appSourcePath = fileURLToPath(new URL('./App.tsx', import.meta.url))
const stylesPath = fileURLToPath(new URL('./styles.css', import.meta.url))

describe('answer-to-Note action', () => {
  it('renders one unified Note toolbar for the complete Ask', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain('aria-label="整理为 Note"')
    expect(appSource).toContain("messages.some((message) => message.role === 'assistant')")
    expect(appSource).toContain('新建 Note')
    expect(appSource).toContain('更新 Note')
    expect(appSource).not.toContain('aria-label="创建 Note from answer"')
    expect(appSource).not.toContain('createNoteFromAnswer(message)')

    const toolbarSource = appSource.match(
      /<section aria-label="整理为 Note"[^]*?{isSelectingAskNoteTopics/
    )?.[0]

    expect(toolbarSource).toBeDefined()
    expect(toolbarSource).not.toContain('<NotesIcon />')
  })

  it('plans the entire Ask before generating topic-scoped titles and Markdown', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain('messages: getCurrentAskNoteMessages()')
    expect(appSource).toContain('englishAskBridge.planAskNotes')
    expect(appSource).toContain('planResult.data.topics.length === 1')
    expect(appSource).toContain('getMessagesForAskNoteTopics(askMessages, topics)')
    expect(appSource).toContain('getAskNoteOriginalMarkdown(')
    expect(appSource).toContain('getGeneratedNoteTitle(formattedResult.data.title || getAskNoteQuestion(topicMessages))')
    expect(appSource).toContain("operation: 'create'")
    expect(appSource).toContain("operation: 'update'")
    expect(appSource).toContain('existingNote: existingNoteResult.data')
    expect(appSource).toContain('markdown: formattedResult.data.markdown')
    expect(appSource).toContain('aria-label="选择要更新的 Note"')
  })

  it('offers separate or merged creation when multiple topics are detected', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain('aria-label="Ask 的 Note 主题"')
    expect(appSource).toContain('个主题')
    expect(appSource).toContain('合并所选主题')
    expect(appSource).toContain('创建 ${selectedAskNoteTopicIds.length} 个 Notes')
    expect(appSource).toContain('createSelectedAskNoteTopics(true)')
    expect(appSource).toContain('createSelectedAskNoteTopics(false)')
    expect(appSource).toContain('updateAskNoteTopicSelection(')
  })

  it('keeps the Ask toolbar outside the scrolling answer region', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')
    expect(appSource.indexOf('aria-label="整理为 Note"')).toBeLessThan(
      appSource.indexOf('className="conversation"')
    )
    const styles = await readFile(stylesPath, 'utf8')
    const toolbarStyles = styles.match(/\.askNoteToolbar\s*{([^}]*)}/s)?.[1]

    expect(toolbarStyles).toBeDefined()
    expect(toolbarStyles).toMatch(/width:\s*100%;/)
    expect(toolbarStyles).toMatch(/border-bottom:\s*1px solid #2d2e31;/)
    expect(toolbarStyles).not.toMatch(/position:\s*sticky;/)
    expect(toolbarStyles).not.toMatch(/background:/)
    expect(toolbarStyles).not.toMatch(/box-shadow:/)
    expect(toolbarStyles).not.toMatch(/backdrop-filter:/)
    expect(styles).toMatch(
      /\.askNoteUpdatePicker\s*{[^}]*justify-content:\s*space-between;[^}]*border-top:\s*1px solid #3f4044;/s
    )
    expect(styles).toMatch(
      /\.askNoteTopicPicker\s*{[^}]*display:\s*grid;[^}]*border-top:\s*1px solid #3f4044;/s
    )
    expect(styles).toMatch(
      /\.askNoteTopicList\s*{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(180px,\s*1fr\)\);/s
    )
    expect(styles).not.toContain('.createNoteFromAnswerButton')
  })
})
