import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export function readSelectOptions(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value: string; children: ReactNode; disabled?: boolean }>(child)) return []
    return [{ value: child.props.value, label: Children.toArray(child.props.children).join(''), disabled: child.props.disabled }]
  })
}

export function nextSelectIndex(options: SelectOption[], current: number, direction: number): number {
  for (let step = 1; step <= options.length; step += 1) {
    const index = (current + direction * step + options.length) % options.length
    if (!options[index].disabled) return index
  }
  return -1
}

export function selectMenuPosition(rect: { left: number; top: number; bottom: number; width: number }, width: number, height: number) {
  const margin = 8
  const gap = 6
  const preferredHeight = 280
  const below = Math.max(0, height - rect.bottom - margin - gap)
  const above = Math.max(0, rect.top - margin - gap)
  const upwards = below < preferredHeight && above > below
  return {
    left: Math.max(margin, Math.min(rect.left, width - rect.width - margin)),
    width: Math.min(rect.width, width - margin * 2),
    maxHeight: Math.min(preferredHeight, upwards ? above : below),
    ...(upwards ? { bottom: height - rect.top + gap } : { top: rect.bottom + gap })
  }
}

interface AppSelectProps {
  'aria-label': string
  children: ReactNode
  disabled?: boolean
  value: string
  onValueChange: (value: string) => void
}

export function AppSelect({ children, disabled, value, onValueChange, 'aria-label': label }: AppSelectProps) {
  const options = readSelectOptions(children)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [position, setPosition] = useState<ReturnType<typeof selectMenuPosition>>()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const search = useRef({ text: '', time: 0 })
  const id = useId()
  const selected = options.findIndex((option) => option.value === value)
  const enabled = !disabled && options.some((option) => !option.disabled)
  const expanded = open && enabled
  const positioned = Boolean(position)

  function show(direction = 1) {
    if (!enabled) return
    search.current = { text: '', time: 0 }
    setActive(selected >= 0 && !options[selected].disabled ? selected : nextSelectIndex(options, direction === 1 ? -1 : 0, direction))
    setOpen(true)
  }

  function choose(index: number) {
    const option = options[index]
    if (!option || option.disabled) return
    setOpen(false)
    trigger.current?.focus()
    if (option.value !== value) onValueChange(option.value)
  }

  useEffect(() => { if (!enabled) setOpen(false) }, [enabled])
  useLayoutEffect(() => {
    if (!expanded) return
    function place() {
      if (trigger.current) setPosition(selectMenuPosition(trigger.current.getBoundingClientRect(), window.innerWidth, window.innerHeight))
    }
    function outside(event: PointerEvent) {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false)
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('pointerdown', outside)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('pointerdown', outside)
    }
  }, [expanded])

  useEffect(() => {
    if (expanded) menu.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }, [active, expanded, positioned])

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Tab') { setOpen(false); return }
    if (event.key === 'Escape') {
      if (expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
      return
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      if (!expanded) { show(event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1); return }
      if (event.key === 'Enter' || event.key === ' ') { choose(active); return }
      const direction = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1
      const start = event.key === 'Home' ? -1 : event.key === 'End' ? 0 : active
      setActive(nextSelectIndex(options, start, direction))
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const now = Date.now()
      const typeaheadTimeout = 700
      const text = (now - search.current.time < typeaheadTimeout ? search.current.text : '') + event.key.toLowerCase()
      search.current = { text, time: now }
      const index = options.findIndex((option) => !option.disabled && option.label.toLowerCase().startsWith(text))
      if (!expanded) show()
      if (index >= 0) setActive(index)
    }
  }

  return (
    <>
      <button ref={trigger} type="button" className="appSelectTrigger" role="combobox"
        aria-label={label} aria-haspopup="listbox" aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        aria-activedescendant={expanded && active >= 0 ? id + '-' + active : undefined}
        disabled={!enabled} onKeyDown={keyDown}
        onBlur={() => setOpen(false)} onClick={() => expanded ? setOpen(false) : show()}>
        <span>{options[selected]?.label || '\u00a0'}</span>
        {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      </button>
      {expanded && position ? createPortal(
        <div ref={menu} id={id} className="appSelectMenu" role="listbox" aria-label={label} style={position}
          onMouseDown={(event) => event.preventDefault()}>
          {options.map((option, index) => (
            <div key={option.value} id={id + '-' + index} role="option"
              aria-selected={value === option.value} aria-disabled={option.disabled || undefined}
              data-active={index === active} className="appSelectOption"
              onPointerMove={() => { if (!option.disabled) setActive(index) }}
              onClick={(event) => { event.stopPropagation(); choose(index) }}>
              <span>{option.label}</span>
              {value === option.value ? <Check size={15} aria-hidden="true" /> : null}
            </div>
          ))}
        </div>, document.body
      ) : null}
    </>
  )
}
