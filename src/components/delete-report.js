'use client'

import { useActionState, useEffect, useId, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { adminDeleteReportAction } from '@/app/actions'
import { ActionMessage } from '@/components/action-ui'
import { formatDate } from '@/lib/format'

export function DeleteReport({ reportId, date, count }) {
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [state, action, pending] = useActionState(adminDeleteReportAction, null)
  const heading = useId()
  useEffect(() => { if (state?.ok) setOpen(false) }, [state])
  useEffect(() => {
    const close = (event) => { if (event.key === 'Escape' && !pending) setOpen(false) }
    if (open) document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [open, pending])
  if (!reportId) return <ActionMessage state={state} />
  return <div>
    <button type="button" className="button danger" onClick={() => { setConfirmation(''); setOpen(true) }}><Trash2 size={18} />Delete This Report</button>
    {!open && !state?.ok && <ActionMessage state={state} />}
    {open && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !pending) setOpen(false) }}>
      <div className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby={heading}>
        <div className="modal-head"><h2 id={heading}>Delete report for {formatDate(date)}?</h2><button type="button" className="icon-button" aria-label="Close deletion confirmation" disabled={pending} onClick={() => setOpen(false)}><X /></button></div>
        <p>This permanently deletes this report and all {count} entries across every section for {formatDate(date)}. Cash balances and outstanding dues will update. Customer, supplier and overhead names will remain available.</p>
        <form action={action} className="entry-form">
          <input type="hidden" name="report_id" value={reportId} />
          <input type="hidden" name="business_date" value={date} />
          <input type="hidden" name="confirm" value="yes" />
          <label><span>Type {date} to confirm</span><input name="confirm_date" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" required autoFocus disabled={pending} /></label>
          <ActionMessage state={state} />
          <div className="form-actions"><button type="button" className="button ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="button danger" disabled={pending || confirmation !== date}>{pending ? 'Deleting…' : 'Delete All Entries for This Date'}</button></div>
        </form>
      </div>
    </div>}
  </div>
}
