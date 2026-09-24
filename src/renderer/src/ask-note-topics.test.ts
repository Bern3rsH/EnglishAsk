import { describe, expect, it } from 'vitest'
import type { AskNoteTopic, ChatMessage } from '../../shared/ai'
import {
  getAskNoteOriginalMarkdown,
  getAskNoteQuestion,
  getMessagesForAskNoteTopics,
  getSelectedAskNoteTopics,
  updateAskNoteTopicSelection
} from './ask-note-topics'

const messages: ChatMessage[] = [
  { id: 'q1', role: 'user', content: 'cold turkey', createdAt: '1' },
  { id: 'a1', role: 'assistant', content: '停止 suddenly.', createdAt: '2' },
  { id: 'q2', role: 'user', content: 'wind down', createdAt: '3' },
  { id: 'a2', role: 'assistant', content: 'Relax gradually.', createdAt: '4' }
]

const topics: AskNoteTopic[] = [
  { id: 'topic-1', title: 'cold turkey', messageIds: ['q1', 'a1'] },
  { id: 'topic-2', title: 'wind down', messageIds: ['q2', 'a2'] }
]

describe('Ask Note topic helpers', () => {
  it('keeps selected topics in the AI-planned order', () => {
    expect(getSelectedAskNoteTopics(topics, ['topic-2', 'topic-1'])).toEqual(topics)
  })

  it('collects selected topic messages in conversation order', () => {
    expect(getMessagesForAskNoteTopics(messages, [topics[1], topics[0]])).toEqual(messages)
    expect(getMessagesForAskNoteTopics(messages, [topics[1]])).toEqual(messages.slice(2))
  })

  it('preserves assistant Markdown exactly and uses the original topic question', () => {
    const topicMessages = getMessagesForAskNoteTopics(messages, [topics[1]])

    expect(getAskNoteQuestion(topicMessages)).toBe('wind down')
    expect(getAskNoteOriginalMarkdown(topicMessages)).toBe('Relax gradually.')

    const multiAnswerMessages: ChatMessage[] = [
      ...topicMessages,
      {
        id: 'a3',
        role: 'assistant',
        content: '## Examples\n\n- Keep **this** formatting.  ',
        createdAt: '5'
      }
    ]

    expect(getAskNoteOriginalMarkdown(multiAnswerMessages)).toBe(
      'Relax gradually.\n\n## Examples\n\n- Keep **this** formatting.  '
    )
  })

  it('adds and removes topic selections without duplicates', () => {
    expect(updateAskNoteTopicSelection(['topic-1'], 'topic-2', true)).toEqual([
      'topic-1',
      'topic-2'
    ])
    expect(updateAskNoteTopicSelection(['topic-1'], 'topic-1', false)).toEqual([])
  })
})
