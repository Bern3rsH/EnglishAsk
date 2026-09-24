export const CONVERSATION_AUTO_SCROLL_THRESHOLD_PX = 96
export const CONVERSATION_QUESTION_TOP_OFFSET_PX = 28
export const DEFAULT_LIST_PANEL_WIDTH_PX = 292
export const MIN_LIST_PANEL_WIDTH_PX = 220
export const MAX_LIST_PANEL_WIDTH_PX = 560
export const PRIMARY_SIDEBAR_WIDTH_PX = 156
export const MIN_DETAIL_WORKSPACE_WIDTH_PX = 360

export type AppWorkspace = 'asks' | 'notes'
export type SettingsSection = 'models' | 'jev' | 'prompts' | 'storage'

export const getSidebarNavItemClassName = (isActive: boolean): string => {
  return isActive ? 'sidebarNavItem sidebarNavItem-active' : 'sidebarNavItem'
}

export const shouldShowProviderModelNames = (
  hasTypedApiKey: boolean,
  hasSavedOrEnvironmentApiKey: boolean,
  isSelectedProviderSaved: boolean
): boolean => {
  return hasTypedApiKey || (hasSavedOrEnvironmentApiKey && isSelectedProviderSaved)
}

export const clampListPanelWidth = (
  requestedWidth: number,
  viewportWidth: number
): number => {
  const finiteRequestedWidth = Number.isFinite(requestedWidth)
    ? requestedWidth
    : DEFAULT_LIST_PANEL_WIDTH_PX
  const viewportConstrainedMaximum = Math.max(
    MIN_LIST_PANEL_WIDTH_PX,
    viewportWidth - PRIMARY_SIDEBAR_WIDTH_PX - MIN_DETAIL_WORKSPACE_WIDTH_PX
  )
  const maximumWidth = Math.min(
    MAX_LIST_PANEL_WIDTH_PX,
    viewportConstrainedMaximum
  )

  return Math.round(
    Math.min(
      Math.max(finiteRequestedWidth, MIN_LIST_PANEL_WIDTH_PX),
      maximumWidth
    )
  )
}

interface ConversationScrollPosition {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

interface ConversationScrollDimensions {
  clientHeight: number
  scrollHeight: number
}

interface CompletedQuestionScrollPosition extends ConversationScrollDimensions {
  answerBottom: number
  questionTop: number
  conversationScrollTop: number
  conversationTop: number
}

export const shouldAutoScrollConversation = (
  position: ConversationScrollPosition,
  threshold = CONVERSATION_AUTO_SCROLL_THRESHOLD_PX
): boolean => {
  const distanceFromBottom = position.scrollHeight - position.scrollTop - position.clientHeight

  return distanceFromBottom <= threshold
}

export const getRestoredConversationScrollTop = (
  savedScrollTop: number | undefined,
  position: ConversationScrollDimensions
): number => {
  const maximumScrollTop = Math.max(0, position.scrollHeight - position.clientHeight)

  if (savedScrollTop === undefined || !Number.isFinite(savedScrollTop)) {
    return maximumScrollTop
  }

  return Math.min(Math.max(savedScrollTop, 0), maximumScrollTop)
}

export const getCompletedQuestionStartScrollTop = (
  position: CompletedQuestionScrollPosition,
  topOffset = CONVERSATION_QUESTION_TOP_OFFSET_PX
): number | null => {
  const availableTurnHeight = Math.max(0, position.clientHeight - topOffset)
  const turnHeight = position.answerBottom - position.questionTop

  if (turnHeight <= availableTurnHeight) {
    return null
  }

  const maximumScrollTop = Math.max(0, position.scrollHeight - position.clientHeight)
  const requestedScrollTop =
    position.conversationScrollTop +
    position.questionTop -
    position.conversationTop -
    topOffset

  return Math.min(Math.max(requestedScrollTop, 0), maximumScrollTop)
}
