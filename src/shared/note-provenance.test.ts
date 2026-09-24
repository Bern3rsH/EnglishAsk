import { describe, expect, it } from 'vitest'
import { mergeNoteSources, preserveNoteFrontmatter, readNoteProvenance, replaceNoteBody, withNoteProvenance, withoutNoteProvenance, type NoteProvenance } from './note-provenance'

const metadata: NoteProvenance = {
  version: 1, note_id: '18c8db31-71d6-48e8-a189-b41b4eb14033',
  sources: [{ ask_id: 'ask-1', message_ids: ['q', 'a'] }]
}

describe('Note provenance frontmatter', () => {
  it.each(['', 'Plain text\n', '---\ntitle: My title\ncustom: [one, two]\n---\n\nBody', '\uFEFF---\r\n# user comment\r\ncustom: yes\r\n---\r\nBody'])('round trips content and user frontmatter exactly: %j', body => {
    const markdown = withNoteProvenance(body, metadata)
    expect(readNoteProvenance(markdown)).toEqual(metadata)
    expect(withoutNoteProvenance(markdown)).toBe(body)
    expect(withNoteProvenance(markdown, metadata)).toBe(markdown)
  })

  it('merges multiple Asks and deduplicates messages without changing order', () => {
    expect(mergeNoteSources(metadata.sources, [
      { ask_id: 'ask-1', message_ids: ['a', 'follow-up'] },
      { ask_id: 'ask-2', message_ids: ['q', 'a'] }
    ])).toEqual([
      { ask_id: 'ask-1', message_ids: ['q', 'a', 'follow-up'] },
      { ask_id: 'ask-2', message_ids: ['q', 'a'] }
    ])
  })

  it('keeps provenance when the editor replaces visible Markdown', () => {
    const edited = replaceNoteBody(withNoteProvenance('Old', metadata), 'New')
    expect(readNoteProvenance(edited)).toEqual(metadata)
    expect(withoutNoteProvenance(edited)).toBe('New')
  })

  it('preserves authoritative user frontmatter through model output', () => {
    expect(preserveNoteFrontmatter('---\ncustom: yes\n---\nOld', '---\ncustom: no\n---\nNew'))
      .toBe('---\ncustom: yes\n---\nNew')
  })

  it.each([
    '---\nenglish_ask: broken\n---\nBody',
    '---\nenglish_ask: {"version":2}\n---\nBody',
    '---\nenglish_ask: {}\nenglish_ask: {}\n---\nBody',
    '---\n"english_ask": {}\n---\nBody',
    '---\nenglish_ask : {}\n---\nBody',
    '---\nunclosed header'
  ])('rejects invalid metadata on writes without hiding it: %s', markdown => {
    expect(() => withNoteProvenance(markdown, metadata)).toThrow()
    expect(withoutNoteProvenance(markdown)).toBe(markdown)
  })

  it('does not interpret body text as metadata', () => {
    expect(readNoteProvenance('Example\n---\nenglish_ask: {}\n---\n')).toBeUndefined()
  })

  it('keeps incomplete frontmatter editable until storage validation', () => {
    expect(replaceNoteBody(withNoteProvenance('Old', metadata), '---\ncustom: typing'))
      .toBe('---\ncustom: typing')
  })

  it('rejects empty or unbounded source identifiers', () => {
    expect(() => mergeNoteSources([{ ask_id: '', message_ids: ['q'] }])).toThrow()
    expect(() => mergeNoteSources([{ ask_id: 'ask', message_ids: ['x'.repeat(241)] }])).toThrow()
  })
})
