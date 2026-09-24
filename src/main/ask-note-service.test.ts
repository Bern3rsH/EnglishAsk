import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, NoteDocument } from '../shared/ai'
import {
  buildFormatAskNotePrompt,
  buildPlanAskNotesPrompt,
  formatAskNote,
  parseAskNotePlan,
  parseFormattedAskNote,
  planAskNotes,
  validatePlanAskNotesRequest,
  validateFormatAskNoteRequest
} from './ask-note-service'
import { generateProviderText } from './provider-adapters'
import { readNoteProvenance, withNoteProvenance, withoutNoteProvenance } from '../shared/note-provenance'

vi.mock('./provider-adapters', () => ({
  generateProviderText: vi.fn()
}))

vi.mock('./settings', () => ({
  getConfiguredDefaultAnswerLanguage: vi.fn().mockResolvedValue('en'),
  getConfiguredModelProvider: vi.fn().mockResolvedValue('openai'),
  getConfiguredProviderModel: vi.fn().mockResolvedValue('gpt-4.1'),
  getEnvironmentProviderApiKey: vi.fn(),
  getStoredProviderApiKey: vi.fn().mockResolvedValue('saved-key')
}))

const messages: ChatMessage[] = [
  {
    id: 'question',
    role: 'user',
    content: 'What does cold turkey mean?',
    createdAt: '2026-08-20T09:00:00.000Z'
  },
  {
    id: 'answer',
    role: 'assistant',
    content: 'It means stopping a habit suddenly.',
    createdAt: '2026-08-20T09:00:01.000Z'
  }
]

const existingNote: NoteDocument = {
  id: 'Habits.md',
  title: 'Habits',
  markdown: '## Existing\n\nUseful material.',
  createdAt: '2026-08-19T09:00:00.000Z',
  updatedAt: '2026-08-19T09:00:00.000Z'
}

const multiTopicMessages: ChatMessage[] = [
  ...messages.map((message) =>
    message.role === 'assistant'
      ? {
          ...message,
          routerDiagnostic: {
            status: 'success' as const,
            classification: {
              inputType: 'phrase' as const,
              structureType: 'fixed_expression' as const,
              targetText: 'cold turkey',
              targets: ['cold turkey'],
              focusText: '',
              intent: 'explain_meaning' as const,
              modules: ['meaning' as const, 'usage' as const, 'examples' as const],
              confidence: 0.96,
              needsClarification: false,
              clarificationQuestion: '',
              responseMode: 'card' as const
            }
          }
        }
      : message
  ),
  {
    id: 'question-2',
    role: 'user',
    content: 'What does wind down mean?',
    createdAt: '2026-08-20T09:01:00.000Z'
  },
  {
    id: 'answer-2',
    role: 'assistant',
    content: 'It means to relax gradually.',
    createdAt: '2026-08-20T09:01:01.000Z'
  }
]

describe('Ask Note service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(generateProviderText).mockResolvedValue(
      JSON.stringify({ markdown: '## Meaning\n\nStop suddenly.' })
    )
  })

  it.each(['create', 'update'] as const)('writes source type and intent tags into the %s Note without relying on AI', async operation => {
    const taggedMessages = messages.map(message => message.role === 'assistant'
      ? { ...message, answerTags: ['单词', '解释含义'] } : message)
    const result = await formatAskNote({ operation, messages: taggedMessages,
      ...(operation === 'update' ? { existingNote } : {}) })
    expect(result.markdown).toBe('#单词 #解释含义\n\n## Meaning\n\nStop suddenly.')
  })

  it('builds a create prompt from the complete Ask conversation', () => {
    const request = validateFormatAskNoteRequest({ operation: 'create', messages })
    const prompt = JSON.parse(buildFormatAskNotePrompt(request, 'en'))

    expect(prompt.operation).toBe('create')
    expect(prompt.conversation).toEqual(
      messages.map(({ role, content }) => ({ role, content }))
    )
    expect(prompt.existingNote).toBeUndefined()
  })

  it('builds a topic-planning prompt with message IDs and available Router targets', () => {
    const request = validatePlanAskNotesRequest({ messages: multiTopicMessages })
    const prompt = JSON.parse(buildPlanAskNotesPrompt(request, 'en'))

    expect(prompt.messages).toHaveLength(4)
    expect(prompt.messages[1].routingHint).toEqual({
      inputType: 'phrase',
      targetText: 'cold turkey',
      targets: ['cold turkey']
    })
    expect(prompt.messages[3].routingHint).toBeUndefined()
  })

  it('parses a complete chronological multi-topic partition', () => {
    const output = JSON.stringify({
      topics: [
        {
          title: 'cold turkey',
          messageIds: ['answer', 'question']
        },
        {
          title: 'wind down',
          messageIds: ['question-2', 'answer-2']
        }
      ]
    })

    expect(parseAskNotePlan(output, multiTopicMessages)).toEqual({
      topics: [
        {
          id: 'topic-1',
          title: 'cold turkey',
          messageIds: ['question', 'answer']
        },
        {
          id: 'topic-2',
          title: 'wind down',
          messageIds: ['question-2', 'answer-2']
        }
      ]
    })
  })

  it('rejects incomplete, overlapping, and unknown topic message assignments', () => {
    expect(() =>
      parseAskNotePlan(
        JSON.stringify({
          topics: [{ title: 'cold turkey', messageIds: ['question', 'answer'] }]
        }),
        multiTopicMessages
      )
    ).toThrow('assign every conversation message exactly once')

    expect(() =>
      parseAskNotePlan(
        JSON.stringify({
          topics: [
            { title: 'cold turkey', messageIds: ['question', 'answer'] },
            { title: 'wind down', messageIds: ['answer', 'question-2', 'answer-2'] }
          ]
        }),
        multiTopicMessages
      )
    ).toThrow('must not contain duplicate message IDs')

    expect(() =>
      parseAskNotePlan(
        JSON.stringify({
          topics: [
            {
              title: 'cold turkey',
              messageIds: ['question', 'answer', 'missing-message']
            }
          ]
        }),
        multiTopicMessages
      )
    ).toThrow('unknown message ID')
  })

  it('plans topics with the configured model before Note formatting', async () => {
    vi.mocked(generateProviderText).mockResolvedValueOnce(
      JSON.stringify({
        topics: [
          { title: 'cold turkey', messageIds: ['question', 'answer'] },
          { title: 'wind down', messageIds: ['question-2', 'answer-2'] }
        ]
      })
    )

    await expect(planAskNotes({ messages: multiTopicMessages })).resolves.toHaveProperty(
      'topics',
      expect.arrayContaining([
        expect.objectContaining({ title: 'cold turkey' }),
        expect.objectContaining({ title: 'wind down' })
      ])
    )
    expect(vi.mocked(generateProviderText).mock.calls[0]?.[0].systemPrompt).toContain(
      'Assign every message exactly once'
    )
  })

  it('keeps multi-topic Ask updates scoped to the selected existing Note', async () => {
    const coldTurkeyNote = {
      ...existingNote,
      id: 'cold turkey.md',
      title: 'cold turkey'
    }

    await formatAskNote({
      operation: 'update',
      messages: multiTopicMessages,
      existingNote: coldTurkeyNote
    })
    const providerOptions = vi.mocked(generateProviderText).mock.calls[0]?.[0]
    const prompt = JSON.parse(providerOptions?.prompt ?? '{}')

    expect(prompt.existingNote).toEqual({
      title: coldTurkeyNote.title,
      markdown: coldTurkeyNote.markdown
    })
    expect(prompt.conversation).toEqual(
      multiTopicMessages.map(({ role, content }) => ({ role, content }))
    )
    expect(providerOptions?.systemPrompt).toContain(
      'existing Note title and Markdown as the authoritative topic scope'
    )
    expect(providerOptions?.systemPrompt).toContain(
      'Ignore unrelated conversation topics entirely'
    )
    expect(providerOptions?.systemPrompt).toContain('Preserve useful existing material')
    expect(providerOptions?.systemPrompt).toContain('return the existing Markdown unchanged')
  })

  it('parses fenced JSON and rejects empty Markdown', () => {
    expect(
      parseFormattedAskNote('```json\n{"markdown":"## Study note"}\n```')
    ).toEqual({ markdown: '## Study note' })
    expect(() => parseFormattedAskNote('{"markdown":""}')).toThrow(
      'Formatted Ask Note Markdown cannot be empty.'
    )
  })

  it('requires an existing Note for update operations', () => {
    expect(() => validateFormatAskNoteRequest({ operation: 'update', messages })).toThrow(
      'Updating a Note requires the existing Note.'
    )
  })

  it('generates a content-based title and body in one formatting call with follow-ups', async () => {
    const conversation: ChatMessage[] = [...messages,
      { id: 'follow-up', role: 'user', content: 'Give me usage examples too.', createdAt: '2026-08-20T09:01:00Z' },
      { id: 'follow-up-answer', role: 'assistant', content: 'He quit smoking cold turkey.', createdAt: '2026-08-20T09:01:01Z' }
    ]
    vi.mocked(generateProviderText).mockResolvedValueOnce(JSON.stringify({ title: 'cold turkey: meaning and usage', markdown: '## Meaning\n\nStop suddenly.\n\n## Example\n\nHe quit smoking cold turkey.' }))
    const result = await formatAskNote({ operation: 'create', messages: conversation })
    expect(result.title).toBe('cold turkey: meaning and usage')
    expect(generateProviderText).toHaveBeenCalledTimes(1)
    const request = vi.mocked(generateProviderText).mock.calls[0][0]
    expect(JSON.parse(request.prompt).conversation).toHaveLength(4)
    expect(request.systemPrompt).toContain('including relevant follow-ups')
    expect(request.systemPrompt).toContain('"title":"...","markdown":"..."')
  })

  it.each([undefined, '', '  ', 42, '../escape', '# Heading', 'Title.md', 'A\nB', 'x'.repeat(61)])(
    'keeps usable Markdown when the generated title is invalid: %j', title => {
      expect(parseFormattedAskNote(JSON.stringify({ title, markdown: '## Meaning\n\nUseful content.' })))
        .toEqual({ markdown: '## Meaning\n\nUseful content.' })
    }
  )

  it('ignores an unsolicited replacement title when updating an existing note', async () => {
    vi.mocked(generateProviderText).mockResolvedValueOnce(JSON.stringify({ title: 'Unexpected rename', markdown: existingNote.markdown }))
    expect(await formatAskNote({ operation: 'update', messages, existingNote }))
      .toEqual({ markdown: existingNote.markdown })
  })
})


describe('Ask Note provenance', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records exact selected Ask messages on creation without copying the transcript', async () => {
    vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify({ title: 'Meaning', markdown: 'Complete learning content' }))
    const result = await formatAskNote({ operation: 'create', askId: 'ask-1', messages })
    expect(readNoteProvenance(result.markdown)?.sources).toEqual([{ ask_id: 'ask-1', message_ids: ['question', 'answer'] }])
    expect(withoutNoteProvenance(result.markdown)).toBe('Complete learning content')
    expect(result.markdown).not.toContain(messages[0].content)
  })

  it('merges only validated relevant messages and preserves identity and custom frontmatter', async () => {
    const original = withNoteProvenance('---\ncustom: keep\n---\nOld', {
      version: 1, note_id: '18c8db31-71d6-48e8-a189-b41b4eb14033',
      sources: [{ ask_id: 'first-ask', message_ids: ['old-question'] }]
    })
    vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify({ markdown: 'Updated', sourceMessageIds: ['answer', 'question', 'answer'] }))
    const result = await formatAskNote({ operation: 'update', askId: 'second-ask', messages: multiTopicMessages,
      existingNote: { ...existingNote, markdown: original } })
    expect(readNoteProvenance(result.markdown)).toEqual({ ...readNoteProvenance(original), sources: [
      { ask_id: 'first-ask', message_ids: ['old-question'] },
      { ask_id: 'second-ask', message_ids: ['question', 'answer'] }
    ] })
    expect(withoutNoteProvenance(result.markdown)).toContain('custom: keep')
    expect(JSON.parse(vi.mocked(generateProviderText).mock.calls[0][0].prompt).existingNote.markdown).not.toContain('english_ask')
    const repeated = await formatAskNote({ operation: 'update', askId: 'second-ask', messages: multiTopicMessages,
      existingNote: { ...existingNote, markdown: result.markdown } })
    expect(repeated.markdown).toBe(result.markdown)
  })

  it.each([undefined, [], ['invented'], [null]])('rejects invalid update source references: %j', async sourceMessageIds => {
    vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify({ markdown: 'Changed', sourceMessageIds }))
    await expect(formatAskNote({ operation: 'update', askId: 'ask-1', messages, existingNote })).rejects.toThrow('更新来源无效')
  })

  it('does not add provenance for unchanged content or require message citations for a no-op', async () => {
    vi.mocked(generateProviderText).mockResolvedValue(JSON.stringify({ markdown: existingNote.markdown, sourceMessageIds: [] }))
    expect(await formatAskNote({ operation: 'update', askId: 'ask-1', messages, existingNote }))
      .toEqual({ markdown: existingNote.markdown })
  })

  it('rejects invalid Ask IDs before calling the provider', async () => {
    await expect(formatAskNote({ operation: 'create', askId: '', messages })).rejects.toThrow('来源 ID 无效')
    expect(generateProviderText).not.toHaveBeenCalled()
  })
})
