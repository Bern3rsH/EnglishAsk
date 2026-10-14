import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import {
  buildContext,
  findChunksByKeyword,
  loadSampleChunks,
  splitNoteIntoChunks
} from './rag-note-demo.mjs'

const markdown = '# used to\n\n## 含义\n表示过去经常发生的动作。\n\n## 结构\nused to + 动词原形。'
const expectedChunks = [
  { source: 'used-to.md', title: 'used to / 含义', text: '表示过去经常发生的动作。\n\n' },
  { source: 'used-to.md', title: 'used to / 结构', text: 'used to + 动词原形。\n' }
]

test('preserves both sections, blank lines and the final section without duplication', () => {
  assert.deepEqual(splitNoteIntoChunks(markdown, 'used-to.md'), expectedChunks)
})

test('reads the topic and source from each note instead of hardcoding them', () => {
  assert.deepEqual(splitNoteIntoChunks('# be used to\n## 含义\n表示已经习惯。', 'be-used-to.md'), [
    { source: 'be-used-to.md', title: 'be used to / 含义', text: '表示已经习惯。\n' }
  ])
})

test('keeps adjacent empty sections and repeated section titles as separate chunks', () => {
  assert.deepEqual(splitNoteIntoChunks('# 主题\n## 章节\n## 章节\n正文', 'note.md'), [
    { source: 'note.md', title: '主题 / 章节', text: '' },
    { source: 'note.md', title: '主题 / 章节', text: '正文\n' }
  ])
})

test('the teaching splitter ignores pre-section text and returns no chunks without sections', () => {
  assert.deepEqual(splitNoteIntoChunks('', 'empty.md'), [])
  assert.deepEqual(splitNoteIntoChunks('# 主题\n介绍', 'intro.md'), [])
  assert.deepEqual(splitNoteIntoChunks('# 主题\n介绍\n## 章节\n正文', 'note.md'), [
    { source: 'note.md', title: '主题 / 章节', text: '正文\n' }
  ])
})

test('searches titles as well as bodies and preserves complete source objects', () => {
  const chunks = splitNoteIntoChunks(markdown, 'used-to.md')
  const before = structuredClone(chunks)
  assert.deepEqual(findChunksByKeyword(chunks, '含义'), [expectedChunks[0]])
  assert.deepEqual(findChunksByKeyword(chunks, '动词原形'), [expectedChunks[1]])
  assert.strictEqual(findChunksByKeyword(chunks, '含义')[0], chunks[0])
  assert.deepEqual(chunks, before)
})

test('normalizes surrounding query whitespace and English capitalization', () => {
  assert.deepEqual(findChunksByKeyword(expectedChunks, ' USED TO '), expectedChunks)
})

test('returns no matches for empty queries, empty corpora and absent literal words', () => {
  for (const keyword of ['', ' \n ', '适应']) {
    assert.deepEqual(findChunksByKeyword(expectedChunks, keyword), [])
  }
  assert.deepEqual(findChunksByKeyword([], 'used to'), [])
})

test('context contains original text and its associated title and source in order', () => {
  assert.equal(buildContext(expectedChunks),
    '来源: used-to.md \n 标题: used to / 含义 \n 表示过去经常发生的动作。\n\n\n\n' +
    '来源: used-to.md \n 标题: used to / 结构 \n used to + 动词原形。\n')
  assert.equal(buildContext([]), '')
})

test('rejects invalid input contracts', () => {
  assert.throws(() => splitNoteIntoChunks(null, 'note.md'), /Markdown/)
  assert.throws(() => splitNoteIntoChunks(markdown, ''), /Filename/)
  assert.throws(() => findChunksByKeyword(null, '习惯'), /array/)
  assert.throws(() => findChunksByKeyword(expectedChunks, null), /Keyword/)
  assert.throws(() => buildContext([{ title: '标题', text: '正文' }]), /chunk/)
})

test('loads six sections from two actual synthetic Markdown files with correct provenance', async () => {
  const chunks = await loadSampleChunks()
  assert.equal(chunks.length, 6)
  assert.equal(chunks.filter(chunk => chunk.source === 'used-to.md').length, 3)
  assert.equal(chunks.filter(chunk => chunk.source === 'be-used-to.md').length, 3)
  const matches = findChunksByKeyword(chunks, '习惯')
  assert.deepEqual(matches.map(chunk => chunk.title), ['be used to / 含义', 'be used to / 例句'])
  assert(matches.every(chunk => chunk.source === 'be-used-to.md' && chunk.text.includes('习惯')))
})

test('CLI reports literal matches and no-match results without calling a model', () => {
  const execute = keyword => JSON.parse(execFileSync(process.execPath,
    [new URL('./rag-note-demo.mjs', import.meta.url).pathname,
      ...(keyword === undefined ? [] : [keyword])], { encoding: 'utf8' }))
  const result = execute()
  assert.equal(result.chunkCount, 6)
  assert.equal(result.matchedChunks.length, 2)
  assert.equal(result.generationCalled, false)
  assert(result.context.includes('来源: be-used-to.md'))
  assert.equal(execute(' USED TO ').matchedChunks.length, 6)
  const noMatches = execute('适应')
  assert.deepEqual(noMatches.matchedChunks, [])
  assert.equal(noMatches.context, '')
  assert.equal(noMatches.message, '没有找到匹配的笔记片段')
})
