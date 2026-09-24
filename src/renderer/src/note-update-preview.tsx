import { useEffect, useRef } from 'react'
import { MarkdownContent } from './markdown'
import { withoutNoteProvenance } from '../../shared/note-provenance'

interface NoteUpdatePreviewProps {
  title: string
  before: string
  after: string
  saving: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

export function NoteUpdatePreview({ title, before, after, saving, error, onCancel, onConfirm }: NoteUpdatePreviewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current!
    const previousFocus = document.activeElement
    dialog.showModal()
    cancelRef.current?.focus()
    return () => {
      dialog.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="noteUpdatePreview"
      aria-labelledby="noteUpdatePreviewTitle"
      aria-busy={saving}
      onCancel={(event) => {
        event.preventDefault()
        if (!saving) onCancel()
      }}
    >
      <header>
        <h2 id="noteUpdatePreviewTitle">更新预览：{title}</h2>
      </header>
      <div className="noteUpdateComparison">
        <section aria-label="更新前">
          <h3>更新前</h3>
          <div tabIndex={0} className="noteUpdateContent">
            {withoutNoteProvenance(before) ? <MarkdownContent content={withoutNoteProvenance(before)} /> : <p>空白笔记</p>}
          </div>
        </section>
        <section aria-label="更新后">
          <h3>更新后</h3>
          <div tabIndex={0} className="noteUpdateContent">
            <MarkdownContent content={withoutNoteProvenance(after)} />
          </div>
        </section>
      </div>
      {error ? <p className="errorMessage" role="alert">{error}</p> : null}
      <footer>
        {before === after ? <span>内容没有变化</span> : null}
        <button ref={cancelRef} disabled={saving} onClick={onCancel} type="button">取消</button>
        <button disabled={saving || before === after} onClick={onConfirm} type="button">
          {saving ? '保存中…' : '确认更新'}
        </button>
      </footer>
    </dialog>
  )
}
