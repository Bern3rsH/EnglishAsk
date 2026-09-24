import { mkdtemp, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNote, getNote, renameNote, saveNote } from './note-storage'
import { generateAnkiDrafts, loadAnkiDrafts, saveAnkiDrafts } from './anki-drafts'
import { generateProviderText } from './provider-adapters'
import { getStoredProviderApiKey } from './settings'
import { readNoteProvenance } from '../shared/note-provenance'
import type { AnkiDraftSet } from '../shared/anki'

vi.mock('./provider-adapters', () => ({ generateProviderText: vi.fn() }))
vi.mock('./settings', () => ({
  getConfiguredModelProvider: vi.fn().mockResolvedValue('deepseek'),
  getConfiguredProviderModel: vi.fn().mockResolvedValue('test-model'),
  getStoredProviderApiKey: vi.fn().mockResolvedValue('test-key'),
  getEnvironmentProviderApiKey: vi.fn(),
  getConfiguredNoteStorageDirectory: vi.fn()
}))
const directories: string[] = []
const card = { front: '“请某人做某事”的句型？', back: 'ask sb to do sth', explanation: '后接不定式。', tags: ['句型'] }
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'englishask-anki-'))
  directories.push(directory)
  const note = await createNote(directory, '---\nprivate: hidden\n---\n#句型\n\nask sb to do sth：请某人做某事。后接不定式。', 'ask 句型')
  return { directory, note, request: { noteId: note.id, expectedMarkdown: note.markdown, expectedDirectory: directory, modelProvider: 'deepseek', modelName: 'test-model' } }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getStoredProviderApiKey).mockResolvedValue('test-key')
  vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify({ cards: [card] }))
})
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('Note to Anki drafts', () => {
  it('generates from Note body only, assigns identities and leaves the Note unchanged', async () => {
    const { request, directory, note } = await fixture()
    const drafts = await generateAnkiDrafts(request, directory)
    expect(drafts.sourceNoteId).toBe(readNoteProvenance(note.markdown)?.note_id)
    expect(drafts.cards[0]).toMatchObject({ ...card, id: expect.any(String), selected: true })
    const options = vi.mocked(generateProviderText).mock.calls[0][0]
    expect(options.modelProvider).toBe('deepseek')
    expect(options.signal).toBeDefined()
    expect(options.prompt).not.toContain('private')
    expect(options.prompt).not.toContain('english_ask')
    expect(await readFile(join(directory, note.id), 'utf8')).toBe(note.markdown)
    expect(await loadAnkiDrafts(request, directory)).toEqual({ drafts: null, stale: false })
  })

  it('deduplicates generated questions and never trusts generated IDs', async () => {
    const { request, directory } = await fixture()
    vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify({ cards: [
      { ...card, id: '../../bad' }, { ...card, front: `  ${card.front} ` }
    ] }))
    const drafts = await generateAnkiDrafts(request, directory)
    expect(drafts.cards).toHaveLength(1)
    expect(drafts.cards[0].id).not.toBe('../../bad')
  })

  it('saves edits and selection separately and restores them after renaming the Note', async () => {
    const { request, directory, note } = await fixture()
    const drafts = await generateAnkiDrafts(request, directory)
    drafts.cards[0] = { ...drafts.cards[0], back: 'My edited answer', selected: false }
    const saved = await saveAnkiDrafts({ ...request, drafts, expectedDraftRevision: null }, directory)
    expect(saved.revision).not.toBe(drafts.revision)
    const renamed = await renameNote({ id: note.id, name: 'Renamed' }, directory)
    const loaded = await loadAnkiDrafts({ ...request, noteId: renamed.id }, directory)
    expect(loaded).toEqual({ drafts: saved, stale: false })
    expect(await readdir(directory)).toContain('.englishask-anki')
    expect((await getNote(renamed.id, directory)).markdown).toBe(note.markdown)
  })

  it('detects edited source content without deleting prior drafts', async () => {
    const { request, directory, note } = await fixture()
    const drafts = await generateAnkiDrafts(request, directory)
    const saved = await saveAnkiDrafts({ ...request, drafts, expectedDraftRevision: null }, directory)
    const changed = await saveNote({ id: note.id, markdown: 'Different knowledge' }, directory)
    const nextRequest = { ...request, expectedMarkdown: changed.markdown }
    expect(await loadAnkiDrafts(nextRequest, directory)).toEqual({ drafts: saved, stale: true })
    await expect(saveAnkiDrafts({ ...nextRequest, drafts: saved, expectedDraftRevision: saved.revision }, directory)).rejects.toThrow('Note 已更新')
  })

  it('rejects conflicting saves while keeping the first edit', async () => {
    const { request, directory } = await fixture()
    const drafts = await generateAnkiDrafts(request, directory)
    const results = await Promise.allSettled([
      saveAnkiDrafts({ ...request, drafts, expectedDraftRevision: null }, directory),
      saveAnkiDrafts({ ...request, drafts, expectedDraftRevision: null }, directory)
    ])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect((await loadAnkiDrafts(request, directory)).drafts?.cards).toEqual(drafts.cards)
  })

  it('rejects stale Note snapshots and different directories before model calls', async () => {
    const { request, directory } = await fixture()
    await expect(generateAnkiDrafts({ ...request, expectedMarkdown: 'old' }, directory)).rejects.toThrow('Note 内容已变更')
    await expect(generateAnkiDrafts({ ...request, expectedDirectory: '/different' }, directory)).rejects.toThrow('目录已变更')
    expect(generateProviderText).not.toHaveBeenCalled()
  })

  it('rechecks the Note after generation and ignores obsolete output', async () => {
    const { request, directory, note } = await fixture()
    vi.mocked(generateProviderText).mockImplementationOnce(async () => {
      await saveNote({ id: note.id, markdown: 'External edit' }, directory)
      return JSON.stringify({ cards: [card] })
    })
    await expect(generateAnkiDrafts(request, directory)).rejects.toThrow('Note 内容已变更')
  })

  it('shares simultaneous generation requests for the same snapshot', async () => {
    const { request, directory } = await fixture()
    let finish!: (value: string) => void
    vi.mocked(generateProviderText).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const first = generateAnkiDrafts(request, directory)
    await vi.waitFor(() => expect(generateProviderText).toHaveBeenCalledTimes(1))
    const second = generateAnkiDrafts(request, directory)
    await new Promise(resolve => setTimeout(resolve, 20))
    finish(JSON.stringify({ cards: [card] }))
    expect(await second).toEqual(await first)
    expect(generateProviderText).toHaveBeenCalledTimes(1)
  })

  it.each(['broken', '{"cards":[]}', JSON.stringify({ cards: [{ ...card, front: '' }] }), JSON.stringify({ cards: Array(21).fill(card) })])('rejects unusable model output without saving it: %s', async output => {
    const { request, directory } = await fixture()
    vi.mocked(generateProviderText).mockResolvedValue(output)
    await expect(generateAnkiDrafts(request, directory)).rejects.toThrow()
    expect((await loadAnkiDrafts(request, directory)).drafts).toBeNull()
  })

  it('keeps existing saved drafts when regeneration fails and hides provider error details', async () => {
    const { request, directory } = await fixture()
    const drafts = await generateAnkiDrafts(request, directory)
    const saved = await saveAnkiDrafts({ ...request, drafts, expectedDraftRevision: null }, directory)
    vi.mocked(generateProviderText).mockRejectedValue(new Error('secret-token-provider-body'))
    await expect(generateAnkiDrafts(request, directory)).rejects.toThrow('卡片生成失败或超时')
    expect((await loadAnkiDrafts(request, directory)).drafts).toEqual(saved)
  })

  it('rejects empty and oversized Notes and missing credentials', async () => {
    const { directory } = await fixture()
    for (const markdown of ['', '#句型', 'x'.repeat(60_001)]) {
      const note = await createNote(directory, markdown)
      await expect(generateAnkiDrafts({ noteId: note.id, expectedMarkdown: note.markdown, expectedDirectory: directory, modelProvider: 'deepseek', modelName: 'test-model' }, directory)).rejects.toThrow()
    }
    const { request, directory: other } = await fixture()
    vi.mocked(getStoredProviderApiKey).mockResolvedValue(undefined)
    await expect(generateAnkiDrafts(request, other)).rejects.toThrow('API Key')
    expect(generateProviderText).not.toHaveBeenCalled()
  })

  it('does not overwrite corrupt saved drafts or follow a symlink draft directory', async () => {
    const { request, directory } = await fixture()
    const drafts = await generateAnkiDrafts(request, directory)
    const saved = await saveAnkiDrafts({ ...request, drafts, expectedDraftRevision: null }, directory)
    const path = join(directory, '.englishask-anki', `${saved.sourceNoteId}.json`)
    await writeFile(path, 'bad json')
    await expect(loadAnkiDrafts(request, directory)).rejects.toThrow('无法读取')
    await expect(saveAnkiDrafts({ ...request, drafts, expectedDraftRevision: null }, directory)).rejects.toThrow('无法读取')
    expect(await readFile(path, 'utf8')).toBe('bad json')
    const other = await fixture()
    await symlink(join(directory, '.englishask-anki'), join(other.directory, '.englishask-anki'))
    await expect(loadAnkiDrafts(other.request, other.directory)).rejects.toThrow('无法读取')
  })

  it('rejects source forgery and invalid edited cards', async () => {
    const { request, directory } = await fixture()
    const drafts = await generateAnkiDrafts(request, directory)
    const wrongSource: AnkiDraftSet = { ...drafts, sourceNoteId: '11111111-1111-1111-1111-111111111111' }
    await expect(saveAnkiDrafts({ ...request, drafts: wrongSource, expectedDraftRevision: null }, directory)).rejects.toThrow('Note 已更新')
    drafts.cards[0].back = ''
    await expect(saveAnkiDrafts({ ...request, drafts, expectedDraftRevision: null }, directory)).rejects.toThrow('字段为空')
  })
})


describe('conservative Anki card volume', () => {
  const variants = (target: string, count: number) => Array.from({ length: count }, (_, index) => ({
    ...card, target, front: `${target} question ${index + 1}`
  }))

  it('reduces 14 cards about draw attention to to three without extra provider calls', async () => {
    const { directory } = await fixture()
    const note = await createNote(directory, 'draw attention to：让人注意到。\n## 释义\n## 用法\n## 例句\n## 易错点', 'draw attention to')
    const request = { noteId: note.id, expectedMarkdown: note.markdown, expectedDirectory: directory, modelProvider: 'deepseek', modelName: 'test-model' }
    vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify({
      learningTargets: ['draw attention to'], cards: variants('draw attention to', 14)
    }))
    const result = await generateAnkiDrafts(request, directory)
    expect(result.cards).toHaveLength(3)
    expect(result.cards.map(item => item.front)).toEqual(variants('draw attention to', 3).map(item => item.front))
    expect(generateProviderText).toHaveBeenCalledTimes(1)
    expect((await loadAnkiDrafts(request, directory)).drafts).toBeNull()
  })

  it.each([undefined, ['invented one', 'invented two'], ['ask sb to do sth', 'ask', 'to']])(
    'uses the single-target ceiling for missing, invented or component targets: %j', async learningTargets => {
      const { request, directory } = await fixture()
      vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify({ learningTargets, cards: variants('ask sb to do sth', 14) }))
      expect((await generateAnkiDrafts(request, directory)).cards).toHaveLength(3)
    }
  )

  it('allows six cards across independent source-backed targets with at most three per target', async () => {
    const { directory } = await fixture()
    const note = await createNote(directory, 'draw attention to：让人注意到。\nwind down：逐渐放松。', '两个表达')
    const request = { noteId: note.id, expectedMarkdown: note.markdown, expectedDirectory: directory, modelProvider: 'deepseek', modelName: 'test-model' }
    vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify({
      learningTargets: ['draw attention to', 'wind down'],
      cards: [...variants('draw attention to', 8), ...variants('wind down', 6)]
    }))
    const result = await generateAnkiDrafts(request, directory)
    expect(result.cards).toHaveLength(6)
    expect(result.cards.filter(item => item.front.startsWith('draw attention to'))).toHaveLength(3)
    expect(result.cards.filter(item => item.front.startsWith('wind down'))).toHaveLength(3)
  })

  it('keeps a useful single card without filling the budget', async () => {
    const { request, directory } = await fixture()
    expect((await generateAnkiDrafts(request, directory)).cards).toHaveLength(1)
  })

  it('leaves previously saved 14-card drafts readable and editable', async () => {
    const { request, directory } = await fixture()
    const generated = await generateAnkiDrafts(request, directory)
    const drafts = { ...generated, cards: variants('existing', 14).map((item, index) => ({ ...item, id: `existing-${index}`, selected: index < 2 })) }
    const saved = await saveAnkiDrafts({ ...request, drafts, expectedDraftRevision: null }, directory)
    expect((await loadAnkiDrafts(request, directory)).drafts).toEqual(saved)
    expect(saved.cards).toHaveLength(14)
  })
})


it('uses the explicitly selected provider and model rather than global defaults', async () => {
  const { request, directory } = await fixture()
  await generateAnkiDrafts({ ...request, modelProvider: 'openai', modelName: 'gpt-4.1' }, directory)
  expect(getStoredProviderApiKey).toHaveBeenCalledWith('openai')
  expect(generateProviderText).toHaveBeenCalledWith(expect.objectContaining({ modelProvider: 'openai', modelName: 'gpt-4.1' }))
})

it('rejects missing, unsupported and non-text model selections before contacting a provider', async () => {
  const { request, directory } = await fixture()
  for (const selection of [{ modelProvider: undefined }, { modelProvider: 'invalid' }, { modelName: '' }, { modelName: 'tts-1' }, { modelName: 'bad\nmodel' }]) {
    await expect(generateAnkiDrafts({ ...request, ...selection }, directory)).rejects.toThrow()
  }
  expect(generateProviderText).not.toHaveBeenCalled()
})

it('does not deduplicate different model selections for the same Note', async () => {
  const { request, directory } = await fixture()
  await Promise.all([
    generateAnkiDrafts(request, directory),
    generateAnkiDrafts({ ...request, modelName: 'different-model' }, directory)
  ])
  expect(generateProviderText).toHaveBeenCalledTimes(2)
})
