import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadSampleChunks } from './rag-note-demo.mjs'
import { extractQueryKeywords, rankChunksByQuestion } from './rag-query-demo.mjs'

test('extracts the topic from the complete Chinese Notes question', () => {
  assert.deepEqual(extractQueryKeywords('我的笔记中有关习惯的笔记有哪些？'), ['习惯'])
})

test('deduplicates terms, normalizes case and excludes punctuation and spaces', () => {
  assert.deepEqual(extractQueryKeywords(' USED used TO，过去过去？'), ['used', 'to', '过去'])
})

test('does not remove negation or infer synonymous search terms', () => {
  const negativeKeywords = extractQueryKeywords('没有习惯早起')
  assert(negativeKeywords.includes('没有'))
  assert(negativeKeywords.includes('习惯'))
  assert.deepEqual(extractQueryKeywords('适应'), ['适应'])
})

test('empty, punctuation-only and stop-word-only questions produce no terms', () => {
  for (const question of ['', '   ', '？！', '我的笔记有哪些？']) {
    assert.deepEqual(extractQueryKeywords(question), [])
  }
})

test('scores distinct matching terms and ranks stronger matches first without mutating input', () => {
  const chunks = [
    { source: 'one.md', title: '含义', text: '习惯' },
    { source: 'two.md', title: '过去的习惯', text: '习惯习惯' },
    { source: 'three.md', title: '结构', text: '无关内容' }
  ]
  const before = structuredClone(chunks)
  const matches = rankChunksByQuestion(chunks, '过去习惯习惯')
  assert.deepEqual(matches.map(chunk => chunk.source), ['two.md', 'one.md'])
  assert.deepEqual(matches.map(chunk => chunk.score), [2, 1])
  assert.deepEqual(matches[0].matchedKeywords, ['过去', '习惯'])
  assert.deepEqual(chunks, before)
})

test('preserves source order for ties and returns no results with no search terms', () => {
  const chunks = [
    { source: 'one.md', title: '习惯', text: '' },
    { source: 'two.md', title: '含义', text: '习惯' }
  ]
  assert.deepEqual(rankChunksByQuestion(chunks, '习惯').map(chunk => chunk.source), ['one.md', 'two.md'])
  assert.deepEqual(rankChunksByQuestion(chunks, '我的笔记有哪些？'), [])
  assert.deepEqual(rankChunksByQuestion([], '习惯'), [])
})

test('rejects invalid question and chunk contracts', () => {
  assert.throws(() => extractQueryKeywords(null), /Question/)
  assert.throws(() => rankChunksByQuestion(null, '习惯'), /array/)
  assert.throws(() => rankChunksByQuestion([{ title: '习惯', text: '' }], '习惯'), /chunk/)
})

test('retrieves actual sample sections for a full question but still misses literal synonyms', async () => {
  const chunks = await loadSampleChunks()
  const matches = rankChunksByQuestion(chunks, '我的笔记中有关习惯的笔记有哪些？')
  assert.deepEqual(matches.map(chunk => chunk.title), ['be used to / 含义', 'be used to / 例句'])
  assert(matches.every(chunk => chunk.score === 1 && chunk.source === 'be-used-to.md'))
  assert.deepEqual(rankChunksByQuestion(chunks, '我的笔记中有关适应的笔记有哪些？'), [])
})

test('CLI accepts a quoted full question, exposes search terms and does not call a model', () => {
  const result = JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(new URL('./rag-query-demo.mjs', import.meta.url)), '我的笔记中有关习惯的笔记有哪些？'],
    { encoding: 'utf8' }))
  assert.deepEqual(result.keywords, ['习惯'])
  assert.equal(result.matches.length, 2)
  assert(result.context.includes('来源: be-used-to.md'))
  assert.equal(result.generationCalled, false)
})

test('filters can only from recognized expression-request wording, retaining the search subject', () => {
  assert.deepEqual(extractQueryKeywords('根据笔记，逐渐适应夜间工作可以用什么表达？'),
    ['根据', '逐渐', '适应', '夜间', '工作', '用', '什么', '表达'])
  for (const wording of ['可以用什么表达', '可以用哪些表达', '可以用什么说法', '可以用哪些说法']) {
    const keywords = extractQueryKeywords(`夜间工作${wording}？`)
    assert(!keywords.includes('可以'))
    assert(keywords.includes('夜间') && keywords.includes('工作'))
  }
})

test('preserves can as the topic or permission meaning and does not discard negation', () => {
  for (const question of ['可以和能够有什么区别？', '可以是什么意思？', '这里可以使用被动语态吗？']) {
    assert(extractQueryKeywords(question).includes('可以'))
  }
  const keywords = extractQueryKeywords('不可以用什么表达？')
  assert(keywords.some(term => term.includes('不')))
  assert(keywords.some(term => term.includes('可以')))
})

test('does not mutate note content or tokenise away English modal meanings', () => {
  assert.deepEqual(extractQueryKeywords('can cannot could'), ['can', 'cannot', 'could'])
  const chunks = [{ source: 'note.md', title: '含义', text: '这里可以使用被动语态。' }]
  const before = structuredClone(chunks)
  rankChunksByQuestion(chunks, '夜间工作可以用什么表达？')
  assert.deepEqual(chunks, before)
})
