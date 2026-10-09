'use client'

import { useActionState, useCallback, useEffect, useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { adminAddHistoryRecordAction } from '@/app/actions'
import { historyCategories, historyUrl } from '@/lib/history'
import { formatDate } from '@/lib/format'
import { ActionMessage, SubmitButton } from '@/components/action-ui'

function AddRecordForm({ category, date, onClose, onAdded }) {
  const config = historyCategories[category].add
  const [state, action, pending] = useActionState(adminAddHistoryRecordAction, null)
  const [amount, setAmount] = useState('')
  const heading = useId()
  useEffect(() => { if (state?.ok) onAdded(state) }, [state, onAdded])
  useEffect(() => {
    const close = (event) => { if (event.key === 'Escape' && !pending) onClose() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [onClose, pending])
  return <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !pending) onClose() }}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby={heading}>
      <div className="modal-head"><h2 id={heading}>{config.label}</h2><button type="button" className="icon-button" aria-label="Close form" disabled={pending} onClick={onClose}><X /></button></div>
      <form action={action} className="entry-form">
        <input type="hidden" name="category" value={category} />
        <input type="hidden" name="business_date" value={date} />
        <label><span>{config.name}</span><input name="name" maxLength="150" required autoFocus /></label>
        {config.types && <>
          <p className="helper-text">Entry date: {formatDate(date, true)}</p>
          <label><span>Phone Number (optional)</span><input name="phone_number" type="tel" inputMode="tel" maxLength="30" /></label>
          <label><span>Entry Type (optional)</span><select name="entry_type" defaultValue="" required={amount !== ''}><option value="">Name only</option>{config.types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>Amount (optional)</span><div className="money-input"><b>৳</b><input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></div></label>
        </>}
        <ActionMessage state={state} /><div className="form-actions"><button type="button" className="button ghost" disabled={pending} onClick={onClose}>Cancel</button><SubmitButton>Submit</SubmitButton></div>
      </form>
    </div>
  </div>
}

export function AdminAddRecord({ category, path, date }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState(null)
  const close = useCallback(() => setOpen(false), [])
  const added = useCallback((value) => {
    setMessage({ ok: true, message: value.message })
    setOpen(false)
    router.replace(value.entryRecorded ? historyUrl(path, 1, null, value.businessDate) : path)
  }, [path, router])
  return <div><button type="button" className="button secondary" onClick={() => { setMessage(null); setOpen(true) }}><Plus size={18} />{historyCategories[category].add.label}</button><ActionMessage state={message} />{open && <AddRecordForm category={category} date={date} onClose={close} onAdded={added} />}</div>
}
