'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import { ActionMessage } from '@/components/action-ui'

export function DownloadReport({ today }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [pending, setPending] = useState(false)
  const [state, setState] = useState(null)
  const trigger = useRef(null), dialog = useRef(null)
  const heading = useId()
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.querySelector('input')?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape' && dialog.current?.getAttribute('aria-busy') !== 'true') setOpen(false)
      if (event.key !== 'Tab') return
      const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
      const first = controls[0], last = controls.at(-1)
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
      trigger.current?.focus()
    }
  }, [open])

  async function download(event) {
    event.preventDefault()
    if (pending) return
    if (from > to) { setState({ message: 'Date From must be on or before Date To.' }); return }
    setPending(true)
    setState(null)
    try {
      const response = await fetch(`/admin/reports/download?${new URLSearchParams({ from, to })}`, { cache: 'no-store' })
      if (response.redirected) throw new Error('Please sign in again to download reports.')
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to download the report.')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `joarder-pharmacy-report-${from}-to-${to}.xlsx`
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setState({ ok: true, message: 'Your Excel report has been downloaded.' })
      setOpen(false)
    } catch (error) {
      setState({ message: error.message || 'Unable to download the report. Please try again.' })
    } finally { setPending(false) }
  }

  return <section className="card settings-section" id="download-report">
    <h2>Download report</h2>
    <p className="helper-text">Download daily totals and closing cash balances as an Excel file.</p>
    <button ref={trigger} type="button" className="button secondary" onClick={() => { setState(null); setOpen(true) }}><Download size={18} />Download report</button>
    {!open && <ActionMessage state={state} />}
    {open && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !pending) setOpen(false) }}>
      <div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby={heading} aria-busy={pending}>
        <div className="modal-head"><h2 id={heading}>Download report</h2><button type="button" className="icon-button" aria-label="Close download form" disabled={pending} onClick={() => setOpen(false)}><X /></button></div>
        <p className="helper-text">Choose an inclusive date range. Only submitted reports are included. Days without a report have blank activity cells; cash carries forward. All amounts are in BDT.</p>
        <form onSubmit={download} className="entry-form">
          <div className="download-date-range history-filter">
            <label className="date-filter-field"><span>Date From</span><input name="from" type="date" min="1900-01-01" max={today} required value={from} disabled={pending} onChange={(event) => setFrom(event.target.value)} /></label>
            <label className="date-filter-field"><span>Date To</span><input name="to" type="date" min="1900-01-01" max={today} required value={to} disabled={pending} onChange={(event) => setTo(event.target.value)} /></label>
          </div>
          <ActionMessage state={state} />
          <div className="form-actions"><button type="button" className="button ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="button primary" disabled={pending}><Download size={18} />{pending ? 'Downloading…' : 'OK'}</button></div>
        </form>
      </div>
    </div>}
  </section>
}
