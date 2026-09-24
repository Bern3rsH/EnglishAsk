import { MarkdownContent } from './markdown'

const collectText = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectText)
  if (value && typeof value === 'object') {
    return Object.entries(value).filter(([key]) => key !== 'module').flatMap(([, item]) => collectText(item))
  }
  return []
}

export function UnformattedAnswer({ output }: { output: string }) {
  let readable = ''
  try {
    const parsed: unknown = JSON.parse(output.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      readable = collectText([record.answer, record.sections]).join('\n\n')
    }
  } catch { /* Non-JSON output is already suitable for the Markdown renderer. */ }
  return <>
    <MarkdownContent content={readable || output} />
    {readable && <details className="unformattedOriginal"><summary>原始返回</summary><pre>{output}</pre></details>}
  </>
}
