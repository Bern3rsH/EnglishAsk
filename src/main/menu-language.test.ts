import { expect, it, vi } from 'vitest'
import { localizeMenuLabels } from './menu-language'

it('localizes native menu labels without changing roles, shortcuts or actions', () => {
  const click = vi.fn()
  const item = { label: 'Copy', role: 'copy', accelerator: 'CmdOrCtrl+C', click }
  const menu = { items: [{ label: '&Edit', submenu: { items: [item] } }, { label: 'EnglishAsk' }] }
  localizeMenuLabels(menu)
  expect(menu.items[0].label).toBe('编辑')
  expect(item).toEqual({ label: '复制', role: 'copy', accelerator: 'CmdOrCtrl+C', click })
  expect(menu.items[1].label).toBe('EnglishAsk')
})
