import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appSourcePath = fileURLToPath(new URL('./App.tsx', import.meta.url))

describe('development 分类诊断 UI', () => {
  it('stores 分类器 metadata separately from answer content and renders it only in development', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain('result.data.routerDiagnostic,')
    expect(appSource).toContain('result.data.knowledgeCard')
    expect(appSource).toContain(
      'import.meta.env.DEV && message.routerDiagnostic'
    )
    expect(appSource).toContain('diagnostic={message.routerDiagnostic}')
    expect(appSource).toContain('aria-label="分类诊断"')
    expect(appSource).toContain('<dt>响应方式</dt>')
    expect(appSource).toContain('<dt>置信度</dt>')
  })

  it('labels the 分类器 input and structure types explicitly', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toMatch(
      /<dt>输入类型<\/dt>\s*<dd>\{getDiagnosticLabel\(classification\.inputType\)\}<\/dd>/
    )
    expect(appSource).toMatch(
      /<dt>结构<\/dt>\s*<dd>\{getDiagnosticLabel\(classification\.structureType\)\}<\/dd>/
    )
  })

  it('uses the generated card type and shows 无 when no card was returned', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toContain('cardType={message.knowledgeCard?.cardType}')
    expect(appSource).toMatch(
      /<dt>卡片类型<\/dt>\s*<dd>\{cardType \? getDiagnosticLabel\(cardType\) : '无'\}<\/dd>/
    )
  })

  it('renders an automatically returned knowledge card as the primary answer', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).not.toContain("'Generate knowledge card'")
    expect(appSource).not.toContain('englishAskBridge.generateKnowledgeCard({')
    expect(appSource).not.toContain('setKnowledgeCardForMessage(')
    expect(appSource).toContain('formatKnowledgeCardAsMarkdown(')
    expect(appSource).toContain(
      'message.answerLanguage ?? inferKnowledgeCardAnswerLanguage(message.knowledgeCard)'
    )
    expect(appSource).toContain('<MarkdownContent content={getMessageMarkdownContent(message)} />')
    expect(appSource).not.toContain('const KnowledgeCardContent')
    expect(appSource).not.toContain('className="knowledgeCard"')
  })

  it('uses the resolved intent for both displayed answers and note source content', async () => {
    const appSource = await readFile(appSourcePath, 'utf8')

    expect(appSource).toMatch(
      /formatKnowledgeCardAsMarkdown\(\s*message\.knowledgeCard,\s*message\.answerLanguage \?\? inferKnowledgeCardAnswerLanguage\(message\.knowledgeCard\),\s*message\.routerDiagnostic\?\.status === 'success'\s*\? message\.routerDiagnostic\.classification\.intent\s*: undefined\s*\)/
    )
    expect(appSource).toMatch(
      /const getCurrentAskNoteMessages =[^]*?content: getMessageMarkdownContent\(message\)/
    )
    expect(appSource).toContain('<MarkdownContent content={getMessageMarkdownContent(message)} />')
  })
})
