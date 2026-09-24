import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ROUTER_INPUT_TYPES, ROUTER_INTENTS, ROUTER_MODULES, ROUTER_RESPONSE_MODES, ROUTER_STRUCTURE_TYPES } from '../../shared/router'
import { getDiagnosticLabel, InterfaceMessage, localizeInterfaceMessage } from './interface-message'

it('provides Chinese display labels for every diagnostic enum without changing identifiers', () => {
  for (const value of [...ROUTER_INPUT_TYPES, ...ROUTER_INTENTS, ...ROUTER_MODULES,
    ...ROUTER_RESPONSE_MODES, ...ROUTER_STRUCTURE_TYPES]) {
    expect(getDiagnosticLabel(value)).toMatch(/[\u3400-\u9fff]/)
  }
  expect(getDiagnosticLabel('custom-target')).toBe('custom-target')
})

it.each([
  ['[timeout] Grammar review exceeded its 45-second time limit.', '语法审查超过 45 秒'],
  ['[quote_mismatch] Invalid quotation', '引用的内容与原回答不符'],
  ['Add an API key in settings before asking a question.', 'API 密钥'],
  ['HTTP 429', '请求过于频繁'],
  ['fetch failed', '连接失败'],
  ['Note was not found.', '未找到'],
  ['The note already exists.', '同名文件'],
  ['Unknown provider error', '技术详情']
])('localizes status/errors: %s', (message, translated) => {
  expect(localizeInterfaceMessage(message)).toContain(translated)
})

it('preserves Chinese text and safely retains original technical details in a collapsed disclosure', () => {
  expect(localizeInterfaceMessage('Notes 目录已更新。')).toBe('Notes 目录已更新。')
  const markup = renderToStaticMarkup(<InterfaceMessage message={'Provider returned <script>alert(1)</script>'} />)
  expect(markup).toContain('<summary>技术详情</summary>')
  expect(markup).not.toContain('<script>')
  expect(markup).not.toContain(' open=')
  expect(markup).toContain('&lt;script&gt;')
})
