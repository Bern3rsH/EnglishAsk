import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, Pencil, RefreshCw, X } from 'lucide-react'
import { useAnkiAutosave } from './use-anki-autosave'
import type { ModelProvider, NoteDocument } from '../../shared/ai'
import { useAnkiModel } from './use-anki-model'
import { MAX_ANKI_CARDS, MAX_ANKI_FRONT_LENGTH, MAX_ANKI_TEXT_LENGTH, MAX_ANKI_TAGS, MAX_ANKI_TAG_LENGTH,
  parseAnkiCardContent, type LoadedAnkiDrafts, type AnkiDraftSet, type AnkiDraftCard } from '../../shared/anki'

interface Props { note: NoteDocument; directory: string; onClose: () => void }

export function AnkiDraftDialog({ note, directory, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const aliveRef = useRef(true)
  const busyRef = useRef(true)
  const [busy, setBusy] = useState<'load' | 'generate' | 'export' | 'close' | null>('load')
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<'close' | 'regenerate' | null>(null)
  const [previewIds, setPreviewIds] = useState<Set<string>>(new Set())
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [source, setSource] = useState<LoadedAnkiDrafts['source']>()
  const [manualCard, setManualCard] = useState<{ front: string; back: string; explanation: string; tags: string } | null>(null)
  const [manualError, setManualError] = useState<string | null>(null)
  const request = useMemo(() => ({ noteId: note.id, expectedMarkdown: note.markdown, expectedDirectory: directory }), [note.id, note.markdown, directory])
  const model = useAnkiModel()
  const bridge = window.englishAsk
  const autosave = useAnkiAutosave(request, !busy && !stale && !confirmation)
  const { drafts, tagInputs, dirty, saving, saveError } = autosave

  const acceptGenerated = (next: AnkiDraftSet) => {
    autosave.replace(next)
    setPreviewIds(new Set())
    setStale(false)
    setExportMessage(null)
  }

  useEffect(() => {
    aliveRef.current = true
    const dialog = dialogRef.current!
    const previous = document.activeElement
    dialog.showModal()
    return () => {
      aliveRef.current = false
      dialog.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    busyRef.current = true
    setBusy('load')
    setLoadFailed(false)
    setError(null)
    void (async () => {
      let loading = true
      try {
        if (!bridge?.loadAnkiDrafts || !bridge.generateAnkiDrafts) throw new Error('请重启桌面应用后使用 Anki 卡片。')
        const result = await bridge.loadAnkiDrafts(request)
        if (cancelled) return
        if (!result.ok) throw new Error(result.error)
        loading = false
        autosave.load(result.data.drafts)
        setSource(result.data.source)
        setStale(result.data.stale)
      } catch (failure) {
        if (!cancelled) {
          setError(failure instanceof Error ? failure.message : '无法读取卡片。')
          setLoadFailed(loading)
        }
      } finally {
        if (!cancelled) { busyRef.current = false; setBusy(null) }
      }
    })()
    return () => { cancelled = true }
  }, [bridge, request, loadAttempt])

  const generate = async () => {
    if (busyRef.current || !bridge?.generateAnkiDrafts || !model.model || !model.hasKey || model.loading) return
    busyRef.current = true
    setBusy('generate')
    setError(null)
    setConfirmation(null)
    try {
      await autosave.flush()
      const result = await bridge.generateAnkiDrafts({ ...request, modelProvider: model.provider, modelName: model.model })
      if (!aliveRef.current) return
      if (!result.ok) throw new Error(result.error)
      acceptGenerated(result.data)
    } catch (failure) {
      if (aliveRef.current) setError(failure instanceof Error ? failure.message : '卡片生成失败，请重试。')
    } finally {
      if (aliveRef.current) { busyRef.current = false; setBusy(null) }
    }
  }

  const editCard = (id: string, change: Partial<AnkiDraftCard>) => {
    autosave.update(current => ({ ...current, cards: current.cards.map(card => card.id === id ? { ...card, ...change } : card) }))
    setExportMessage(null)
    setError(null)
  }

  const addManualCard = () => {
    if (!manualCard || busyRef.current || stale || loadFailed || confirmation) return
    try {
      if ((drafts?.cards.length ?? 0) >= MAX_ANKI_CARDS) throw new Error(`最多保留 ${MAX_ANKI_CARDS} 张卡片。`)
      if (!manualCard.front.trim() || !manualCard.back.trim()) throw new Error('请填写卡片的正面和背面。')
      const content = parseAnkiCardContent({ ...manualCard, tags: manualCard.tags.split(/[\s,，]+/).filter(Boolean) })
      const card = { ...content, id: crypto.randomUUID(), selected: true }
      if (drafts) autosave.update(current => ({ ...current, cards: [...current.cards, card] }))
      else {
        if (!source) throw new Error('无法读取 Note 来源，请重新打开弹窗。')
        autosave.replace({ version: 1, ...source, revision: crypto.randomUUID(), cards: [card] })
      }
      setManualCard(null)
      setManualError(null)
      setError(null)
      setExportMessage(null)
    } catch (failure) {
      setManualError(failure instanceof Error ? failure.message : '无法添加卡片。')
    }
  }

  const exportCards = async () => {
    if (busyRef.current || !drafts) return
    busyRef.current = true
    setBusy('export')
    setError(null)
    setExportMessage(null)
    try {
      const latest = await autosave.flush()
      if (!latest || !aliveRef.current) return
      if (!bridge?.exportAnkiCards) throw new Error('请重启桌面应用后使用导出。')
      const result = await bridge.exportAnkiCards({ ...request, expectedDraftRevision: latest.revision })
      if (!aliveRef.current) return
      if (!result.ok) throw new Error(result.error)
      if (!result.data.cancelled) setExportMessage(`已导出 ${result.data.count} 张卡片：${result.data.filePath}`)
    } catch (failure) {
      if (aliveRef.current) setError(failure instanceof Error ? failure.message : '导出失败，请重试。')
    } finally {
      if (aliveRef.current) { busyRef.current = false; setBusy(null) }
    }
  }

  const close = async () => {
    if (busyRef.current) return
    if (manualCard && Object.values(manualCard).some(value => value.trim())) {
      setConfirmation('close')
      return
    }
    if (!dirty) { onClose(); return }
    busyRef.current = true
    setBusy('close')
    const saved = await autosave.flush()
    if (aliveRef.current) {
      busyRef.current = false; setBusy(null)
      if (saved) onClose()
      else setConfirmation('close')
    }
  }
  const selectedCount = drafts?.cards.filter(card => card.selected).length ?? 0

  return <dialog className="ankiDraftDialog" ref={dialogRef} aria-labelledby="ankiDraftTitle" aria-busy={!!busy}
    onCancel={event => { event.preventDefault(); void close() }}>
    <header>
      <div><h2 id="ankiDraftTitle">Anki 卡片</h2><p>来源：{note.title}</p></div>
      <button className="ankiIconButton" type="button" aria-label="关闭" title="关闭" disabled={!!busy} onClick={() => void close()}><X aria-hidden="true" /></button>
    </header>
    <div className="ankiDraftBody">
      <fieldset className="ankiModelSelection" disabled={!!busy || model.loading || !!confirmation}>
        <legend>选择制卡模型</legend>
        <label>Provider<select aria-label="制卡 Provider" value={model.providers.length ? model.provider : ''} disabled={!model.providers.length} onChange={event => model.setProvider(event.target.value as ModelProvider)}>
          {!model.providers.length ? <option value=""> </option> : null}
          {model.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
        </select></label>
        <label>模型<select aria-label="制卡模型" value={model.model} disabled={!model.hasKey} onChange={event => model.select(event.target.value)}>
          {!model.hasKey ? <option value=""> </option> : model.options.map(name => <option key={name} value={name}>{name}</option>)}
        </select></label>
        <button className="ankiIconButton" type="button" aria-label="刷新模型" title="刷新模型" disabled={!model.hasKey} onClick={() => void model.refresh()}><RefreshCw aria-hidden="true" /></button>
        <p>仅用于本次制卡，不更改全局模型设置。</p>
        {model.settings && !model.hasKey ? <p role="status">暂无已配置的服务商，请先在设置中保存 API Key。</p> : null}
        {model.error ? <p role="alert">{model.error}{!model.settings ? <button type="button" onClick={model.retry}>重试读取模型</button> : null}</p> : null}
      </fieldset>
      {busy ? <p role="status">{busy === 'load' ? '读取草稿…' : busy === 'generate' ? '正在从 Note 生成卡片…' : busy === 'export' ? '准备导出…' : '保存修改…'}</p> : null}
      {stale ? <p className="ankiDraftNotice" role="status">Note 已更新，以下是旧版本草稿。重新生成后才能导出。</p> : null}
      {error || saveError ? <p role="alert" className="ankiDraftNotice">{error ?? saveError}</p> : null}
      {exportMessage ? <p role="status" className="ankiExportResult">{exportMessage}</p> : null}
      {manualCard ? <fieldset className="ankiDraftCard" disabled={!!busy || !!confirmation}>
        <legend>新建卡片</legend>
        <p>正面和背面必填，添加后自动保存。</p>
        <div className="ankiCardFields">
          <label>正面<textarea autoFocus aria-label="新卡片正面" maxLength={MAX_ANKI_FRONT_LENGTH} value={manualCard.front}
            onChange={event => setManualCard({ ...manualCard, front: event.target.value })} /></label>
          <label>背面<textarea aria-label="新卡片背面" maxLength={MAX_ANKI_TEXT_LENGTH} value={manualCard.back}
            onChange={event => setManualCard({ ...manualCard, back: event.target.value })} /></label>
        </div>
        <label>补充解释<textarea aria-label="新卡片补充解释" maxLength={MAX_ANKI_TEXT_LENGTH} value={manualCard.explanation}
          onChange={event => setManualCard({ ...manualCard, explanation: event.target.value })} /></label>
        <label>标签（空格分隔）<input aria-label="新卡片标签" maxLength={MAX_ANKI_TAGS * (MAX_ANKI_TAG_LENGTH + 1)} value={manualCard.tags}
          onChange={event => setManualCard({ ...manualCard, tags: event.target.value })} /></label>
        {manualError ? <p role="alert">{manualError}</p> : null}
        <div className="ankiDraftCardToolbar">
          <button type="button" onClick={() => { setManualCard(null); setManualError(null) }}>取消新建</button>
          <button type="button" onClick={addManualCard}>添加卡片</button>
        </div>
      </fieldset> : null}
      {drafts ? <>
        <div className="ankiDraftSelection"><span>已选 {selectedCount} / {drafts.cards.length} 张</span>
          <button className="ankiTextButton" type="button" disabled={!!busy || stale} onClick={() => {
            autosave.update(current => ({ ...current, cards: current.cards.map(card => ({ ...card, selected: selectedCount !== drafts.cards.length })) }))
            setExportMessage(null)
          }}>{selectedCount === drafts.cards.length ? '取消全选' : '全选'}</button>
        </div>
        {drafts.cards.map((card, index) => <fieldset className="ankiDraftCard" key={card.id} disabled={!!busy || stale}>
          <legend>卡片 {index + 1}</legend>
          <div className="ankiDraftCardToolbar">
            <label><input type="checkbox" aria-label={`选择卡片 ${index + 1}`} checked={card.selected}
              onChange={event => editCard(card.id, { selected: event.target.checked })} />保留这张卡片</label>
            <button className="ankiIconButton" type="button"
              aria-label={`${previewIds.has(card.id) ? '编辑' : '预览'}卡片 ${index + 1}`}
              title={previewIds.has(card.id) ? '编辑卡片' : '预览卡片'}
              onClick={() => setPreviewIds(current => {
              const next = new Set(current); if (next.has(card.id)) next.delete(card.id); else next.add(card.id); return next
            })}>{previewIds.has(card.id) ? <Pencil aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
          </div>
          {previewIds.has(card.id) ? <div className="ankiCardPreview">
            <section><h3>正面</h3><p>{card.front}</p></section>
            <section><h3>背面</h3><p>{card.back}</p>{card.explanation ? <p className="ankiCardExplanation">{card.explanation}</p> : null}</section>
          </div> : <>
            <div className="ankiCardFields">
              <label>正面<textarea aria-label={`卡片 ${index + 1} 正面`} value={card.front} maxLength={MAX_ANKI_FRONT_LENGTH}
                onChange={event => editCard(card.id, { front: event.target.value })} /></label>
              <label>背面<textarea aria-label={`卡片 ${index + 1} 背面`} value={card.back} maxLength={MAX_ANKI_TEXT_LENGTH}
                onChange={event => editCard(card.id, { back: event.target.value })} /></label>
            </div>
            <label>补充解释<textarea aria-label={`卡片 ${index + 1} 补充解释`} value={card.explanation} maxLength={MAX_ANKI_TEXT_LENGTH}
              onChange={event => editCard(card.id, { explanation: event.target.value })} /></label>
            <label>标签（空格分隔）<input aria-label={`卡片 ${index + 1} 标签`} maxLength={MAX_ANKI_TAGS * (MAX_ANKI_TAG_LENGTH + 1)}
              value={tagInputs[card.id] ?? card.tags.join(' ')} onChange={event => {
                autosave.editTags(card.id, event.target.value); setExportMessage(null)
              }} /></label>
          </>}
        </fieldset>)}
      </> : null}
    </div>
    <footer>
      {confirmation ? <div className="ankiDraftConfirmation" role="status">
        <span>{confirmation === 'close' ? manualCard ? '新卡片尚未添加，关闭将放弃未保存的修改。' : '自动保存失败，修改仍保留在这里。' : '重新生成会替换当前卡片和手动修改。'}</span>
        <button disabled={!!busy} type="button" onClick={() => setConfirmation(null)}>继续编辑</button>
        <button disabled={!!busy} type="button" onClick={() => confirmation === 'close' ? onClose() : void generate()}>
          {confirmation === 'close' ? '放弃修改并关闭' : '确认重新生成'}</button>
      </div> : null}
      <p className="ankiImportHint">导出后，在 Anki 中选择「文件 → 导入」，选择 .txt 文件。Note 类型使用 Basic（正反面）。</p>
      <div className="ankiDraftActions">
        {saveError ? <button disabled={!!busy || stale} type="button" onClick={() => void autosave.flush()}>重试自动保存</button> : null}
        <span role="status">{saveError ? '自动保存失败' : saving ? '自动保存中…' : dirty ? '等待自动保存' : drafts ? '修改已自动保存' : '正反面问答卡'}</span>
        <button type="button" disabled={!!busy || stale || loadFailed || !!confirmation || !!manualCard || (!drafts && !source) || (drafts?.cards.length ?? 0) >= MAX_ANKI_CARDS}
          onClick={() => { setManualCard({ front: '', back: '', explanation: '', tags: '' }); setManualError(null) }}>新建卡片</button>
        {loadFailed ? <button disabled={!!busy} type="button" onClick={() => setLoadAttempt(value => value + 1)}>重试读取</button>
          : <button disabled={!!busy || !!manualCard || !!confirmation || !model.model || !model.hasKey || model.loading} type="button" onClick={() => drafts ? setConfirmation('regenerate') : void generate()}>
            {drafts ? '重新生成' : '生成卡片'}</button>}
        <button className="ankiSaveButton" type="button" disabled={!!busy || !!manualCard || !!confirmation || !drafts || selectedCount === 0 || stale} onClick={() => void exportCards()}>导出所选卡片</button>
      </div>
    </footer>
  </dialog>
}
