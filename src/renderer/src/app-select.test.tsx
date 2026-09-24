// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppSelect, nextSelectIndex, selectMenuPosition } from './app-select'

let root: Root
let host: HTMLDivElement
let change = vi.fn<(value: string) => void>()
const options = [
  <option key="a" value="a">Alpha</option>,
  <option key="b" value="b" disabled>Beta</option>,
  <option key="c" value="c">Chinese</option>
]
const trigger = () => host.querySelector('button')!
const key = async (value: string) => act(() => {
  trigger().dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true }))
})
async function render(disabled = false) {
  await act(() => root.render(<form><AppSelect aria-label="Language" value="a" disabled={disabled} onValueChange={change}>{options}</AppSelect></form>))
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Element.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  change = vi.fn<(value: string) => void>()
  await render()
})
afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
})

it('uses a themed combobox and portal, never a native select', async () => {
  expect(host.querySelector('select')).toBeNull()
  expect(trigger().getAttribute('role')).toBe('combobox')
  expect(trigger().type).toBe('button')
  await act(() => trigger().click())
  expect(document.querySelector('[role="listbox"]')?.parentElement).toBe(document.body)
  expect(document.querySelector('[aria-selected="true"]')?.textContent).toBe('Alpha')
})
it.each(['toggle', 'selection', 'outside', 'Escape', 'Tab', 'blur', 'disabled'])('keeps the arrow synchronized when dismissed by %s', async dismissal => {
  expect(trigger().querySelector('.lucide-chevron-down')).not.toBeNull()
  expect(trigger().querySelector('.lucide-chevron-up')).toBeNull()
  await key('Enter')
  expect(trigger().getAttribute('aria-expanded')).toBe('true')
  expect(trigger().querySelector('.lucide-chevron-up')).not.toBeNull()
  expect(trigger().querySelector('.lucide-chevron-down')).toBeNull()
  if (dismissal === 'toggle') await act(() => trigger().click())
  else if (dismissal === 'selection') await key('Enter')
  else if (dismissal === 'outside') await act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
  else if (dismissal === 'blur') await act(() => trigger().dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  else if (dismissal === 'disabled') await render(true)
  else await key(dismissal)
  expect(trigger().getAttribute('aria-expanded')).toBe('false')
  expect(trigger().querySelector('.lucide-chevron-down')).not.toBeNull()
  expect(trigger().querySelector('.lucide-chevron-up')).toBeNull()
})
it('skips disabled choices and commits keyboard selection without submitting', async () => {
  const submit = vi.fn()
  host.querySelector('form')!.addEventListener('submit', submit)
  await key('ArrowDown')
  await key('ArrowDown')
  await key('Enter')
  expect(change).toHaveBeenCalledExactlyOnceWith('c')
  expect(submit).not.toHaveBeenCalled()
  expect(trigger().getAttribute('aria-expanded')).toBe('false')
})
it('supports typeahead, escape cancellation, and tab dismissal', async () => {
  await key('c')
  expect(document.querySelector('[data-active="true"]')?.textContent).toBe('Chinese')
  await key('Escape')
  expect(change).not.toHaveBeenCalled()
  await key('Enter')
  await key('Tab')
  expect(document.querySelector('[role="listbox"]')).toBeNull()
})
it('selects with a pointer and dismisses outside clicks', async () => {
  await act(() => trigger().click())
  await act(() => (document.querySelectorAll('[role="option"]')[2] as HTMLElement).click())
  expect(change).toHaveBeenCalledWith('c')
  await act(() => trigger().click())
  await act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
  expect(document.querySelector('[role="listbox"]')).toBeNull()
})
it('closes when disabled and prevents disabled choices', async () => {
  await act(() => trigger().click())
  await act(() => (document.querySelectorAll('[role="option"]')[1] as HTMLElement).click())
  expect(change).not.toHaveBeenCalled()
  await render(true)
  expect(trigger().disabled).toBe(true)
  expect(document.querySelector('[role="listbox"]')).toBeNull()
})
it('handles empty choices and menu viewport boundaries', () => {
  expect(nextSelectIndex([], -1, 1)).toBe(-1)
  expect(nextSelectIndex([{ value: 'a', label: 'A', disabled: true }], 0, 1)).toBe(-1)
  expect(selectMenuPosition({ top: 600, bottom: 640, left: 20, width: 300 }, 320, 660))
    .toMatchObject({ bottom: 66, width: 300, left: 12, maxHeight: 280 })
  expect(selectMenuPosition({ top: 10, bottom: 50, left: 0, width: 400 }, 320, 660))
    .toMatchObject({ top: 56, width: 304, left: 8 })
})
