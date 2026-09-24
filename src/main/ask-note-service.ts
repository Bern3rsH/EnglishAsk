import { randomUUID } from 'node:crypto'
import type {
  AskNotePlan,
  ChatMessage,
  FormatAskNoteRequest,
  FormattedAskNote,
  NoteDocument,
  PlanAskNotesRequest
} from '../shared/ai'
import { resolveGeminiApiKey } from './api-key'
import { getAnswerTags, isAnswerTags, withNoteTags } from '../shared/answer-tags'
import { mergeNoteSources, preserveNoteFrontmatter, readNoteProvenance, validateSourceReference, withNoteProvenance, withoutNoteProvenance } from '../shared/note-provenance'
import { generateProviderText } from './provider-adapters'
import { validateRouterClassification } from './router-classifier'
import {
  getConfiguredDefaultAnswerLanguage,
  getConfiguredModelProvider,
  getConfiguredProviderModel,
  getEnvironmentProviderApiKey,
  getStoredProviderApiKey
} from './settings'

const MAX_FORMATTED_NOTE_BYTES = 2 * 1024 * 1024
const MAX_ASK_NOTE_MESSAGES = 500
const MAX_ASK_NOTE_TOPICS = 50
const MAX_ASK_NOTE_TOPIC_TITLE_BYTES = 240
const MAX_FORMATTED_NOTE_TITLE_CHARACTERS = 60
const ASK_NOTE_TOPIC_ID_PREFIX = 'topic-'
const ASK_NOTE_PLAN_SYSTEM_PROMPT = `You segment a complete English-learning conversation into durable Note topics.
Return only valid JSON with exactly this shape: {"topics":[{"title":"...","messageIds":["..."]}]}.
Group follow-up questions about meaning, usage, examples, grammar, or pronunciation with their existing learning target.
Separate messages about unrelated words, expressions, sentences, or grammar concepts into different topics.
Keep an explicit comparison such as "say vs tell" as one topic.
Use routingHint when present as strong evidence, while still resolving contextual follow-ups from conversation order.
Use a short filename-ready title that preserves the English learning target instead of copying the full question.
Use only message IDs supplied in the input. Assign every message exactly once, preserve chronological order inside each topic, and never invent IDs.
Each topic must contain at least one user message and one assistant message.
Do not generate Note Markdown and do not return Markdown fences around the JSON.`
const ASK_NOTE_SYSTEM_PROMPT = `You turn a complete English-learning conversation into a durable Markdown study note.
For create operations, return only valid JSON with exactly this shape: {"title":"...","markdown":"..."}.
For update operations, return only valid JSON with exactly this shape: {"markdown":"..."}. Never rename an existing Note.
For a new Note, write a concise, specific title summarizing the final note content, including relevant follow-ups, not merely the first user question.
Preserve the English learning target and use the requested output language for explanatory wording. Prefer at most 40 characters and never exceed 60 characters.
Use a single plain-text, filename-ready title without Markdown, a file extension, or path separators. Avoid generic wording such as "Detailed explanation of" or "关于...的详细解析".
Examples of titles: "turkey 的词义与用法", "ask sb to do 句型", "say 与 tell 的用法区别".
The Markdown must synthesize the useful learning content instead of copying the transcript mechanically.
Keep the note self-contained: retain the original example sentence and any context necessary to interpret the learning target, relevant examples, and mistakes to avoid.
Do not generate or modify YAML frontmatter or source identifiers in Markdown.
Use clear Markdown sections, lists, examples, tables, and code formatting only when they improve learning.
Do not add a top-level H1 because the local filename is shown separately as the note title.
Do not mention the AI, the chat, the user, or the note-generation process.
For update operations, treat the existing Note title and Markdown as the authoritative topic scope.
Use only conversation material that is semantically relevant to that existing Note. Ignore unrelated conversation topics entirely: do not add, summarize, or create sections for them.
Preserve useful existing material, integrate only relevant new learning content, remove duplication, and keep unrelated existing Note material unchanged.
If the conversation contains no relevant new learning content, return the existing Markdown unchanged.
Never return Markdown fences around the JSON.`

function assertRecord(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(message)
  }
}

const validateOptionalRouterDiagnostic = (
  value: unknown
): ChatMessage['routerDiagnostic'] | undefined => {
  if (value === undefined) {
    return undefined
  }

  assertRecord(value, 'Ask Note Router diagnostic must be an object.')

  if (value.status === 'error' && typeof value.message === 'string') {
    return {
      status: 'error',
      message: value.message
    }
  }

  if (value.status === 'success') {
    return {
      status: 'success',
      classification: validateRouterClassification(value.classification)
    }
  }

  throw new Error('Ask Note Router diagnostic is invalid.')
}

const validateMessages = (value: unknown): ChatMessage[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ASK_NOTE_MESSAGES) {
    throw new Error('Ask Note operations require a non-empty bounded message list.')
  }

  const messages = value.map((messageValue): ChatMessage => {
    assertRecord(messageValue, 'Ask Note message must be an object.')

    if (
      typeof messageValue.id !== 'string' ||
      (messageValue.role !== 'user' && messageValue.role !== 'assistant') ||
      typeof messageValue.content !== 'string' ||
      messageValue.content.trim().length === 0 ||
      typeof messageValue.createdAt !== 'string'
    ) {
      throw new Error('Ask Note message is invalid.')
    }

    const routerDiagnostic = validateOptionalRouterDiagnostic(messageValue.routerDiagnostic)

    return {
      id: messageValue.id,
      role: messageValue.role,
      content: messageValue.content,
      createdAt: messageValue.createdAt,
      ...(isAnswerTags(messageValue.answerTags) ? { answerTags: messageValue.answerTags } : {}),
      ...(routerDiagnostic ? { routerDiagnostic } : {})
    }
  })

  if (new Set(messages.map((message) => message.id)).size !== messages.length) {
    throw new Error('Ask Note message IDs must be unique.')
  }

  return messages
}

const validateExistingNote = (value: unknown): NoteDocument => {
  assertRecord(value, 'Updating a Note requires the existing Note.')

  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.markdown !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new Error('Existing Note is invalid.')
  }

  return value as unknown as NoteDocument
}

export const validateFormatAskNoteRequest = (value: unknown): FormatAskNoteRequest => {
  assertRecord(value, 'Ask Note request must be an object.')

  if (value.operation !== 'create' && value.operation !== 'update') {
    throw new Error('Ask Note operation is invalid.')
  }

  const messages = validateMessages(value.messages)
  const askId = value.askId === undefined ? undefined : validateSourceReference(value.askId)
  if (askId) messages.forEach(message => validateSourceReference(message.id))

  if (value.operation === 'update') {
    return {
      operation: 'update',
      ...(askId ? { askId } : {}),
      messages,
      existingNote: validateExistingNote(value.existingNote)
    }
  }

  return {
    operation: 'create',
    ...(askId ? { askId } : {}),
    messages
  }
}

export const validatePlanAskNotesRequest = (value: unknown): PlanAskNotesRequest => {
  assertRecord(value, 'Ask Note planning request must be an object.')

  return {
    messages: validateMessages(value.messages)
  }
}

const getMessageRoutingHint = (message: ChatMessage): Record<string, unknown> | undefined => {
  if (message.routerDiagnostic?.status !== 'success') {
    return undefined
  }

  const { classification } = message.routerDiagnostic

  return {
    inputType: classification.inputType,
    targetText: classification.targetText,
    targets: classification.targets
  }
}

export const buildPlanAskNotesPrompt = (
  request: PlanAskNotesRequest,
  answerLanguage: 'zh' | 'en'
): string => {
  return JSON.stringify(
    {
      titleLanguage: answerLanguage === 'zh' ? 'Simplified Chinese' : 'English',
      messages: request.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        ...(getMessageRoutingHint(message)
          ? { routingHint: getMessageRoutingHint(message) }
          : {})
      }))
    },
    null,
    2
  )
}

export const buildFormatAskNotePrompt = (
  request: FormatAskNoteRequest,
  answerLanguage: 'zh' | 'en'
): string => {
  return JSON.stringify(
    {
      operation: request.operation,
      outputLanguage: answerLanguage === 'zh' ? 'Simplified Chinese' : 'English',
      conversation: request.messages.map((message) => ({
        ...(request.askId ? { id: message.id } : {}),
        role: message.role,
        content: message.content
      })),
      ...(request.existingNote
        ? {
            existingNote: {
              title: request.existingNote.title,
              markdown: withoutNoteProvenance(request.existingNote.markdown)
            }
          }
        : {})
    },
    null,
    2
  )
}

export const parseFormattedAskNote = (output: string): FormattedAskNote => {
  const normalizedOutput = output
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const parsedOutput = JSON.parse(normalizedOutput) as unknown

  assertRecord(parsedOutput, 'Formatted Ask Note response must be an object.')

  if (typeof parsedOutput.markdown !== 'string' || parsedOutput.markdown.trim().length === 0) {
    throw new Error('Formatted Ask Note Markdown cannot be empty.')
  }

  const markdown = parsedOutput.markdown.trim()

  if (Buffer.byteLength(markdown, 'utf8') > MAX_FORMATTED_NOTE_BYTES) {
    throw new Error('Formatted Ask Note must be 2 MB or smaller.')
  }

  const title = typeof parsedOutput.title === 'string' ? parsedOutput.title.trim() : ''
  const validTitle = title.length > 0 && Array.from(title).length <= MAX_FORMATTED_NOTE_TITLE_CHARACTERS &&
    !/[\r\n\\/\x00-\x1f]/.test(title) && !/^(#|\*|`)|\.md$/i.test(title) &&
    title !== '.' && title !== '..'
  return { markdown, ...(validTitle ? { title } : {}) }
}

export const parseAskNotePlan = (
  output: string,
  messages: ChatMessage[]
): AskNotePlan => {
  const normalizedOutput = output
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const parsedOutput = JSON.parse(normalizedOutput) as unknown

  assertRecord(parsedOutput, 'Ask Note plan response must be an object.')

  if (
    !Array.isArray(parsedOutput.topics) ||
    parsedOutput.topics.length === 0 ||
    parsedOutput.topics.length > MAX_ASK_NOTE_TOPICS
  ) {
    throw new Error('Ask Note plan must contain a bounded non-empty topic list.')
  }

  const messageById = new Map(messages.map((message) => [message.id, message]))
  const assignedMessageIds = new Set<string>()
  const topics = parsedOutput.topics.map((topicValue, topicIndex) => {
    assertRecord(topicValue, 'Ask Note topic must be an object.')

    if (
      typeof topicValue.title !== 'string' ||
      topicValue.title.trim().length === 0 ||
      Buffer.byteLength(topicValue.title.trim(), 'utf8') > MAX_ASK_NOTE_TOPIC_TITLE_BYTES
    ) {
      throw new Error('Ask Note topic title is invalid.')
    }

    if (
      !Array.isArray(topicValue.messageIds) ||
      topicValue.messageIds.length === 0 ||
      topicValue.messageIds.some((messageId) => typeof messageId !== 'string')
    ) {
      throw new Error('Ask Note topic message IDs are invalid.')
    }

    const topicMessageIds = new Set<string>()

    for (const messageId of topicValue.messageIds as string[]) {
      if (!messageById.has(messageId)) {
        throw new Error('Ask Note topic contains an unknown message ID.')
      }

      if (topicMessageIds.has(messageId) || assignedMessageIds.has(messageId)) {
        throw new Error('Ask Note topics must not contain duplicate message IDs.')
      }

      topicMessageIds.add(messageId)
      assignedMessageIds.add(messageId)
    }

    const chronologicalMessageIds = messages
      .filter((message) => topicMessageIds.has(message.id))
      .map((message) => message.id)
    const topicRoles = new Set(
      chronologicalMessageIds.map((messageId) => messageById.get(messageId)?.role)
    )

    if (!topicRoles.has('user') || !topicRoles.has('assistant')) {
      throw new Error('Each Ask Note topic must contain a user question and assistant answer.')
    }

    return {
      id: `${ASK_NOTE_TOPIC_ID_PREFIX}${topicIndex + 1}`,
      title: topicValue.title.trim(),
      messageIds: chronologicalMessageIds
    }
  })

  if (assignedMessageIds.size !== messages.length) {
    throw new Error('Ask Note topics must assign every conversation message exactly once.')
  }

  return { topics }
}

const getAskNoteModelContext = async (): Promise<{
  answerLanguage: 'zh' | 'en'
  apiKey: string
  modelName: string
  modelProvider: Awaited<ReturnType<typeof getConfiguredModelProvider>>
}> => {
  const modelProvider = await getConfiguredModelProvider()
  const modelName = await getConfiguredProviderModel(modelProvider)
  const apiKey = resolveGeminiApiKey(
    await getStoredProviderApiKey(modelProvider),
    getEnvironmentProviderApiKey(modelProvider)
  )

  if (!apiKey) {
    throw new Error('Add an API key in settings before using Ask Notes.')
  }

  return {
    answerLanguage: await getConfiguredDefaultAnswerLanguage(),
    apiKey,
    modelName,
    modelProvider
  }
}

export const planAskNotes = async (input: unknown): Promise<AskNotePlan> => {
  const request = validatePlanAskNotesRequest(input)
  const { answerLanguage, apiKey, modelName, modelProvider } =
    await getAskNoteModelContext()
  const output = await generateProviderText({
    apiKey,
    modelName,
    modelProvider,
    prompt: buildPlanAskNotesPrompt(request, answerLanguage),
    purpose: 'notes-planning',
    systemPrompt: ASK_NOTE_PLAN_SYSTEM_PROMPT
  })

  return parseAskNotePlan(output, request.messages)
}

export const formatAskNote = async (input: unknown): Promise<FormattedAskNote> => {
  const request = validateFormatAskNoteRequest(input)
  const existingMetadata = request.existingNote ? readNoteProvenance(request.existingNote.markdown) : undefined
  const { answerLanguage, apiKey, modelName, modelProvider } =
    await getAskNoteModelContext()
  const output = await generateProviderText({
    apiKey,
    modelName,
    modelProvider,
    prompt: buildFormatAskNotePrompt(request, answerLanguage),
    purpose: 'notes-formatting',
    systemPrompt: ASK_NOTE_SYSTEM_PROMPT + (request.askId && request.operation === 'update'
      ? '\nFor this update, return {"markdown":"...","sourceMessageIds":["..."]}. sourceMessageIds must contain only IDs from conversation messages actually used for relevant new learning content, including necessary question context. Exclude unrelated messages. If nothing changes, return an empty array.'
      : '')
  })

  const formattedNote = parseFormattedAskNote(output)
  formattedNote.markdown = preserveNoteFrontmatter(request.existingNote?.markdown ?? '', formattedNote.markdown)
  if (request.existingNote && formattedNote.markdown.trim() === request.existingNote.markdown.trim()) {
    return { markdown: request.existingNote.markdown }
  }
  formattedNote.markdown = withNoteTags(formattedNote.markdown, [...new Set(request.messages.flatMap(getAnswerTags))])
  if (request.operation === 'update' && formattedNote.markdown === request.existingNote?.markdown) {
    return { markdown: formattedNote.markdown }
  }
  if (request.askId) {
    let messageIds = request.messages.map(message => message.id)
    if (request.operation === 'update') {
      const parsed = JSON.parse(output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
      const allowedIds = new Set(messageIds)
      if (!Array.isArray(parsed.sourceMessageIds) || !parsed.sourceMessageIds.length ||
        parsed.sourceMessageIds.some((id: unknown) => typeof id !== 'string' || !allowedIds.has(id))) {
        throw new Error('Note 更新来源无效，请重新生成预览。')
      }
      const selectedIds = new Set<string>(parsed.sourceMessageIds)
      messageIds = messageIds.filter(id => selectedIds.has(id))
    }
    formattedNote.markdown = withNoteProvenance(formattedNote.markdown, {
      version: 1,
      note_id: existingMetadata?.note_id ?? randomUUID(),
      sources: mergeNoteSources(existingMetadata?.sources ?? [], [{ ask_id: request.askId, message_ids: messageIds }])
    })
  }
  if (Buffer.byteLength(formattedNote.markdown, 'utf8') > MAX_FORMATTED_NOTE_BYTES) {
    throw new Error('Formatted Ask Note must be 2 MB or smaller.')
  }
  return request.operation === 'update'
    ? { markdown: formattedNote.markdown }
    : formattedNote
}
