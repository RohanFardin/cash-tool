'use client'

import { useActionState, useEffect, useState } from 'react'
import { submitReportAction, adminSaveReportEntriesAction } from '@/app/actions'
import { ActionMessage, SubmitButton } from '@/components/action-ui'
import { formatDate } from '@/lib/format'

export function SubmitReport({ status, entries = [], onSubmitted, admin = false, date }) {
  const [open, setOpen] = useState(false)
  const [state, action] = useActionState(admin ? adminSaveReportEntriesAction : submitReportAction, null)
  useEffect(() => {
    if (state?.ok) {
      setOpen(false)
      onSubmitted?.()
    }
  }, [state, onSubmitted])
  if (!admin && status !== 'draft') return <p className="notice success">This report is {status} and locked for users.</p>
  return <>
    <ActionMessage state={state} />
    <button type="button" className="button primary full" disabled={admin && !entries.length} onClick={() => setOpen(true)}>{admin ? 'Save Report Entries' : "Submit Today's Report"}</button>
    {open && <div className="modal-backdrop"><div className="modal confirm-modal" role="dialog" aria-modal="true" aria-label={admin ? 'Save report entries' : 'Submit report'}>
      <h2>{admin ? `Save entries for ${formatDate(date)}?` : "Submit today's report?"}</h2>
      <p>{entries.length} temporary {entries.length === 1 ? 'entry' : 'entries'} will be saved. {admin ? 'The report totals and cash balance will update.' : 'Submitting then locks the report.'}</p>
      <form action={action}>
        <input type="hidden" name="confirm" value="yes" />
        <input type="hidden" name="business_date" value={date || ''} />
        <input type="hidden" name="staged_entries" value={JSON.stringify(entries)} />
        <div className="form-actions"><button type="button" className="button ghost" onClick={() => setOpen(false)}>Cancel</button><SubmitButton pendingText="Saving…">{admin ? 'Yes, Save' : 'Yes, Submit'}</SubmitButton></div>
      </form>
    </div></div>}
  </>
}
