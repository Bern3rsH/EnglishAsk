import type { NoteAnswer, NoteAnswerSource } from '../../shared/rag'

export const NoteAnswerSources = ({ answer, disabled, onOpen }: {
  answer: NoteAnswer
  disabled: boolean
  onOpen: (source: NoteAnswerSource) => void
}) => (
  <aside className="noteAnswerSources" aria-label="笔记回答来源">
    <span className="noteAnswerMode">根据笔记回答{answer.retrievalDiagnostic?.mode === 'hybrid' ? ' · 语义 + 关键词检索' : ''}</span>
    {answer.retrievalDiagnostic?.notice ? <p role="status">{answer.retrievalDiagnostic.notice}</p> : null}
    {answer.sources.map(source => (
      <details key={source.sourceId}>
        <summary>{`[${source.sourceId}] ${source.title}`}</summary>
        <blockquote>{source.quote}</blockquote>
        <button type="button" disabled={disabled} onClick={() => onOpen(source)}
          aria-label={`打开来源 ${source.sourceId}：${source.title}`}>打开原笔记</button>
      </details>
    ))}
  </aside>
)
