'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { taka } from '@/lib/format'

// Render the options in the page so their due colors also appear on phones.
export function CustomerFilter({ label, parties, selectedId }) {
  const id = useId()
  const root = useRef(null)
  const trigger = useRef(null)
  const search = useRef({ text: '', time: 0 })
  const [value, setValue] = useState(String(selectedId || ''))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [popup, setPopup] = useState({ above: false, height: 280 })
  const options = [{ id: '', name: 'All people' }, ...parties]
  const selectedIndex = Math.max(0, options.findIndex((party) => String(party.id) === value))
  const selected = options[selectedIndex]
  const hasDue = (party) => Number(party.current_due) > 0

  useEffect(() => {
    if (!open) return
    const dismiss = (event) => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, id])

  function show(index = selectedIndex) {
    const rect = trigger.current.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    const upwards = below < 160 && above > below
    setPopup({ above: upwards, height: Math.max(96, Math.min(280, upwards ? above : below)) })
    setActive(index)
    setOpen(true)
  }
  function choose(index) {
    setValue(String(options[index].id))
    setOpen(false)
  }
  function onKeyDown(event) {
    const { key } = event
    if (key === 'Escape') { if (open) event.preventDefault(); setOpen(false); return }
    if (key === 'Tab') { if (open) choose(active); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault()
      const index = key === 'Home' ? 0 : key === 'End' ? options.length - 1
        : open ? Math.max(0, Math.min(options.length - 1, active + (key === 'ArrowDown' ? 1 : -1))) : selectedIndex
      if (open) setActive(index); else show(index)
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      if (open) choose(active); else show()
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const text = (Date.now() - search.current.time < 500 ? search.current.text : '') + key.toLocaleLowerCase()
      search.current = { text, time: Date.now() }
      const prefix = [...text].every((character) => character === text[0]) ? text[0] : text
      const start = open ? active : selectedIndex
      for (let step = 1; step <= options.length; step++) {
        const index = (start + step) % options.length
        if (options[index].name.toLocaleLowerCase().startsWith(prefix)) {
          if (open) setActive(index); else show(index)
          break
        }
      }
    }
  }

  return <div className="party-filter customer-filter">
    <label id={`${id}-label`} htmlFor={id}>{label}</label>
    <div className="person-select" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
      <input type="hidden" name="party" value={value} />
      <button id={id} ref={trigger} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-options` : undefined} aria-labelledby={`${id}-label`} aria-activedescendant={open ? `${id}-option-${active}` : undefined} className={`person-select-trigger${hasDue(selected) ? ' has-due' : ''}`} onClick={() => { if (open) setOpen(false); else show() }} onKeyDown={onKeyDown}>
        <span>{selected.name}</span><ChevronDown size={18} aria-hidden="true" />
      </button>
      {open && <div id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`} className={`person-select-options${popup.above ? ' opens-above' : ''}`} style={{ maxHeight: popup.height }}>
        {options.map((party, index) => <button type="button" role="option" id={`${id}-option-${index}`} key={party.id} tabIndex={-1} aria-selected={String(party.id) === value} aria-label={hasDue(party) ? `${party.name}, remaining due ${taka(party.current_due)}` : party.name} className={`person-select-option${hasDue(party) ? ' has-due' : ''}${active === index ? ' is-active' : ''}`} onMouseDown={(event) => event.preventDefault()} onPointerMove={(event) => { if (event.pointerType === 'mouse') setActive(index) }} onClick={() => { choose(index); trigger.current.focus() }}>
          <span>{party.name}</span>{String(party.id) === value && <Check size={16} aria-hidden="true" />}
        </button>)}
      </div>}
    </div>
  </div>
}
