import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL_OPTIONS_BY_PROVIDER,
  supportsDynamicModelListing
} from '../../shared/ai'
import {
  DEFAULT_LIST_PANEL_WIDTH_PX,
  MAX_LIST_PANEL_WIDTH_PX,
  MIN_LIST_PANEL_WIDTH_PX,
  clampListPanelWidth,
  getCompletedQuestionStartScrollTop,
  getRestoredConversationScrollTop,
  getSidebarNavItemClassName,
  shouldAutoScrollConversation,
  shouldShowProviderModelNames
} from './layout'

describe('layout helpers', () => {
  it('marks active sidebar nav items', () => {
    expect(getSidebarNavItemClassName(true)).toBe('sidebarNavItem sidebarNavItem-active')
    expect(getSidebarNavItemClassName(false)).toBe('sidebarNavItem')
  })

  it('constrains either list panel to its minimum width', () => {
    expect(clampListPanelWidth(120, 1200)).toBe(MIN_LIST_PANEL_WIDTH_PX)
  })

  it('preserves space for the detail workspace when resizing', () => {
    expect(clampListPanelWidth(600, 860)).toBe(344)
  })

  it('uses the configured maximum on wide windows', () => {
    expect(clampListPanelWidth(800, 1600)).toBe(MAX_LIST_PANEL_WIDTH_PX)
  })

  it('falls back to the default width for invalid stored values', () => {
    expect(clampListPanelWidth(Number.NaN, 1200)).toBe(DEFAULT_LIST_PANEL_WIDTH_PX)
  })
})

describe('conversation scroll helpers', () => {
  it('follows new content when the conversation is near the bottom', () => {
    expect(
      shouldAutoScrollConversation({
        clientHeight: 600,
        scrollHeight: 1200,
        scrollTop: 520
      })
    ).toBe(true)
  })

  it('keeps the user position when they have scrolled up', () => {
    expect(
      shouldAutoScrollConversation({
        clientHeight: 600,
        scrollHeight: 1200,
        scrollTop: 380
      })
    ).toBe(false)
  })

  it('restores a saved conversation scroll position', () => {
    expect(
      getRestoredConversationScrollTop(320, {
        clientHeight: 600,
        scrollHeight: 1400
      })
    ).toBe(320)
  })

  it('falls back to the bottom when no saved conversation position exists', () => {
    expect(
      getRestoredConversationScrollTop(undefined, {
        clientHeight: 600,
        scrollHeight: 1400
      })
    ).toBe(800)
  })

  it('keeps restored conversation positions inside the scroll range', () => {
    expect(
      getRestoredConversationScrollTop(900, {
        clientHeight: 600,
        scrollHeight: 1000
      })
    ).toBe(400)
    expect(
      getRestoredConversationScrollTop(-80, {
        clientHeight: 600,
        scrollHeight: 1000
      })
    ).toBe(0)
  })

  it('positions an overflowing completed turn at the question, not the answer', () => {
    expect(
      getCompletedQuestionStartScrollTop({
        answerBottom: 1320,
        questionTop: 300,
        clientHeight: 600,
        conversationScrollTop: 500,
        conversationTop: 100,
        scrollHeight: 1800
      })
    ).toBe(672)
  })

  it('includes the question and gap when only the answer would fit', () => {
    expect(
      getCompletedQuestionStartScrollTop({
        answerBottom: 980,
        questionTop: 300,
        clientHeight: 600,
        conversationScrollTop: 500,
        conversationTop: 100,
        scrollHeight: 1800
      })
    ).toBe(672)
  })

  it.each([0, 480, 572])('keeps normal bottom following for a fitting %ipx turn', (turnHeight) => {
    expect(
      getCompletedQuestionStartScrollTop({
        answerBottom: 300 + turnHeight,
        questionTop: 300,
        clientHeight: 600,
        conversationScrollTop: 500,
        conversationTop: 100,
        scrollHeight: 1400
      })
    ).toBeNull()
  })

  it('anchors a turn as soon as it exceeds the available height', () => {
    expect(
      getCompletedQuestionStartScrollTop({
        answerBottom: 873,
        questionTop: 300,
        clientHeight: 600,
        conversationScrollTop: 500,
        conversationTop: 100,
        scrollHeight: 1400
      })
    ).toBe(672)
  })

  it('keeps the question position inside the scroll range', () => {
    expect(
      getCompletedQuestionStartScrollTop({
        answerBottom: 1800,
        questionTop: 900,
        clientHeight: 600,
        conversationScrollTop: 700,
        conversationTop: 100,
        scrollHeight: 1400
      })
    ).toBe(800)
    expect(
      getCompletedQuestionStartScrollTop({
        answerBottom: 1100,
        questionTop: 100,
        clientHeight: 600,
        conversationScrollTop: 0,
        conversationTop: 100,
        scrollHeight: 1400
      })
    ).toBe(0)
  })

  it('resolves the same question anchor from different current scroll positions', () => {
    expect(
      getCompletedQuestionStartScrollTop({
        answerBottom: 620,
        questionTop: -400,
        clientHeight: 600,
        conversationScrollTop: 1200,
        conversationTop: 100,
        scrollHeight: 1800
      })
    ).toBe(672)
  })
})

describe('settings visibility helpers', () => {
  it('shows provider model names only after an API 密钥 is available for the selected provider', () => {
    expect(shouldShowProviderModelNames(false, false, true)).toBe(false)
    expect(shouldShowProviderModelNames(false, true, false)).toBe(false)
    expect(shouldShowProviderModelNames(false, true, true)).toBe(true)
    expect(shouldShowProviderModelNames(true, false, false)).toBe(true)
  })

  it('shows model refresh only for providers with a dynamic listing endpoint', () => {
    expect(supportsDynamicModelListing('google-gemini')).toBe(true)
    expect(supportsDynamicModelListing('openai')).toBe(true)
    expect(supportsDynamicModelListing('deepseek')).toBe(true)
    expect(supportsDynamicModelListing('openrouter')).toBe(true)
  })

  it('uses current static DeepSeek model names', () => {
    expect(DEFAULT_MODEL_OPTIONS_BY_PROVIDER.deepseek).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro'
    ])
  })
})
