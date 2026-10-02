'use client'

import { useActionState, useState } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { saveCashSalesAction, submitReportAction, adminSaveTransactionAction, adminDeleteTransactionAction } from '@/app/actions'
import { approveReportAction } from '@/app/actions'
import { adminUpdateReportAction } from '@/app/actions'
import { ActionMessage, SubmitButton } from '@/components/action-ui'
import { taka } from '@/lib/format'

export function CashSalesForm({ locked }) {
  const [state, action] = useActionState(saveCashSalesAction, null)
  if (locked) return null
  return <form action={action} className="quick-amount-form"><label><span>Enter Amount</span><div className="money-input"><b>৳</b><input name="cash_sales" type="number" inputMode="decimal" min="0.01" step="0.01" required /></div></label><SubmitButton>Add Cash Sales</SubmitButton><ActionMessage state={state} /></form>
}

const labels = {
  credit: { title: 'Credit Sales / Recovery', button: 'Add Entry', name: 'Person Name' },
  supplier_payment: { title: 'Supplier Payments', button: 'Add Supplier Payment', name: 'Supplier Name' },
  cash_purchase: { title: 'Cash Purchases', button: 'Add Cash Purchase', name: 'Seller / Retailer / Supplier' },
  overhead: { title: 'Overhead Costs', button: 'Add Expense', name: 'Expense Name' },
  conveyance: { title: 'Conveyance', button: 'Add Conveyance', name: 'Purpose / Description' },
}

function EntryForm({ category, initial, onClose, admin = false, reportId }) {
  const [state, action] = useActionState(adminSaveTransactionAction, null)
  const config = labels[category]
  return <form action={action} className="entry-form">
    <input type="hidden" name="category" value={category} /><input type="hidden" name="id" value={initial?.id || ''} />{admin && <input type="hidden" name="report_id" value={reportId} />}
    <label><span>{config.name}</span><input name="name" defaultValue={initial?.name || ''} maxLength="150" required autoFocus /></label>
    {category === 'credit' && <label><span>Transaction Type</span><select name="transaction_subtype" defaultValue={initial?.transaction_subtype || 'credit_sale'}><option value="credit_sale">Credit Sale</option><option value="credit_recovery">Credit Recovery</option></select></label>}
    <label><span>Amount</span><div className="money-input"><b>৳</b><input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" defaultValue={initial?.amount || ''} required /></div></label>
    <label><span>Optional Note</span><textarea name="description" rows="3" maxLength="500" defaultValue={initial?.description || ''} /></label>
    <ActionMessage state={state} /><div className="form-actions"><button type="button" className="button ghost" onClick={onClose}>Cancel</button><SubmitButton>{initial ? 'Update Entry' : 'Add Entry'}</SubmitButton></div>
  </form>
}

function DeleteButton({ id, admin, reportId }) {
  const [, action] = useActionState(adminDeleteTransactionAction, null)
  return <form action={action} onSubmit={(event) => { if (!window.confirm('Delete this entry?')) event.preventDefault() }}><input type="hidden" name="id" value={id} />{admin && <input type="hidden" name="report_id" value={reportId} />}<button className="icon-button danger" aria-label="Delete"><Trash2 size={18} /></button></form>
}

export function TransactionManager({ category, entries, locked = false, admin = false, reportId }) {
  const [editing, setEditing] = useState(null)
  const config = labels[category]
  return <>
    {!locked && <button className="button primary add-button" onClick={() => setEditing({})}><Plus size={18} />{config.button}</button>}
    <div className="entry-list">{entries.length === 0 ? <div className="empty-state"><p>No entries yet.</p><span>Tap the add button to record the first one.</span></div> : entries.map((entry) => <article className="entry-card" key={entry.id}><div><strong>{entry.name}</strong><span>{entry.transaction_subtype ? entry.transaction_subtype.replaceAll('_', ' ') : config.title.replace(/s$/, '')}</span>{entry.description && <small>{entry.description}</small>}</div><b>{taka(entry.amount)}</b>{!locked && <div className="entry-actions"><button className="icon-button" onClick={() => setEditing(entry)} aria-label="Edit"><Pencil size={18} /></button><DeleteButton id={entry.id} admin={admin} reportId={reportId} /></div>}</article>)}</div>
    {editing && <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true"><div className="modal-head"><h2>{editing.id ? 'Edit' : 'Add'} {config.title}</h2><button className="icon-button" onClick={() => setEditing(null)}><X /></button></div><EntryForm category={category} initial={editing.id ? editing : null} onClose={() => setEditing(null)} admin={admin} reportId={reportId} /></div></div>}
  </>
}

export function SubmitReport({ status }) {
  const [open, setOpen] = useState(false)
  const [state, action] = useActionState(submitReportAction, null)
  if (status !== 'draft') return <p className="notice success">This report is {status} and locked for storekeepers.</p>
  return <><ActionMessage state={state} /><button className="button primary full" onClick={() => setOpen(true)}>Submit Today's Report</button>{open && <div className="modal-backdrop"><div className="modal confirm-modal"><h2>Submit today's report?</h2><p>Submitting closes today's entry forms and makes your summary available.</p><form action={action}><input type="hidden" name="confirm" value="yes" /><div className="form-actions"><button type="button" className="button ghost" onClick={() => setOpen(false)}>Cancel</button><SubmitButton pendingText="Submitting…">Yes, Submit</SubmitButton></div></form></div></div>}</>
}

export function ApproveReport({ id, status }) {
  const [state, action] = useActionState(approveReportAction, null)
  if (status === 'approved') return <span className="status approved">Approved</span>
  return <form action={action}><input type="hidden" name="id" value={id} /><ActionMessage state={state} /><SubmitButton pendingText="Approving…">Approve Report</SubmitButton></form>
}

export function AdminReportForm({ report }) {
  const [state, action] = useActionState(adminUpdateReportAction, null)
  return <form action={action} className="card admin-report-form"><input type="hidden" name="id" value={report.id} /><div className="inline-fields"><label><span>Cash Sales</span><input name="cash_sales" type="number" inputMode="decimal" min="0" step="0.01" defaultValue={report.cash_sales} required /></label><label><span>Status</span><select name="status" defaultValue={report.status}><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="approved">Approved</option></select></label></div><label><span>Notes</span><textarea name="notes" rows="2" defaultValue={report.notes || ''} /></label><ActionMessage state={state} /><SubmitButton>Save Report</SubmitButton></form>
}
