import type { AskNoteTopic, ChatMessage } from '../../shared/ai'

export const getSelectedAskNoteTopics = (
  topics: AskNoteTopic[],
  selectedTopicIds: string[]
): AskNoteTopic[] => {
  const selectedTopicIdSet = new Set(selectedTopicIds)
  return topics.filter((topic) => selectedTopicIdSet.has(topic.id))
}

export const getMessagesForAskNoteTopics = (
  messages: ChatMessage[],
  topics: AskNoteTopic[]
): ChatMessage[] => {
  const selectedMessageIds = new Set(topics.flatMap((topic) => topic.messageIds))
  return messages.filter((message) => selectedMessageIds.has(message.id))
}

export const getAskNoteQuestion = (messages: ChatMessage[]): string => {
  return messages.find((message) => message.role === 'user')?.content ?? ''
}

export const getAskNoteOriginalMarkdown = (messages: ChatMessage[]): string => {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content)
    .join('\n\n')
}

export const updateAskNoteTopicSelection = (
  selectedTopicIds: string[],
  topicId: string,
  isSelected: boolean
): string[] => {
  const nextSelectedTopicIds = new Set(selectedTopicIds)

  if (isSelected) {
    nextSelectedTopicIds.add(topicId)
  } else {
    nextSelectedTopicIds.delete(topicId)
  }

  return [...nextSelectedTopicIds]
}
