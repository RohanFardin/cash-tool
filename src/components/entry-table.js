'use client'

import { useActionState, useEffect, useId, useState } from 'react'
import { Pencil, X } from 'lucide-react'
import { adminEditEntryAction } from '@/app/actions'
import { ActionMessage, SubmitButton } from '@/components/action-ui'
import { historyCategories } from '@/lib/history'
import { businessDate, dateTime, formatDate, taka } from '@/lib/format'

const typeLabels = { cash_sale: 'Cash Sale', previous_total: 'Previous Daily Total', adjustment: 'Adjustment', credit_sale: 'Credit Sale', credit_recovery: 'Recovery', purchase: 'Purchase', payment: 'Payment' }

function EditEntry({ entry, options, onClose }) {
  const config = historyCategories[entry.category]
  const [state, action] = useActionState(adminEditEntryAction, null)
  const heading = useId()
  useEffect(() => { if (state?.ok) onClose() }, [state, onClose])
  useEffect(() => {
    const close = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [onClose])
  const legacyPayment = entry.source === 'transaction' && entry.category === 'supplier'
  const types = entry.category === 'credit' ? [['credit_sale', 'Credit Sale'], ['credit_recovery', 'Recovery']]
    : legacyPayment ? [['payment', 'Payment']] : [['purchase', 'Purchase'], ['payment', 'Payment']]
  return <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby={heading}>
      <div className="modal-head"><h2 id={heading}>Edit {config.title}</h2><button type="button" className="icon-button" aria-label="Close editor" onClick={onClose}><X /></button></div>
      <p className="helper-text">Entered {dateTime(entry.created_at)}. Saving updates this record.</p>
      <form action={action} className="entry-form">
        <input type="hidden" name="source" value={entry.source} /><input type="hidden" name="id" value={entry.id} />
        {config.party && <><label><span>{config.party}</span><select name="party_id" defaultValue={entry.party_id || ''} required><option value="" disabled>Select {config.party.toLowerCase()}</option>{(options[config.table] || []).map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}</select></label><label><span>Entry Type</span><select name="entry_type" defaultValue={entry.entry_type} required>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></>}
        {entry.category === 'overhead' && <label><span>Overhead Name</span><select name="overhead_category_id" defaultValue={entry.overhead_category_id || ''} required><option value="" disabled>Select overhead cost</option>{(options.overhead || []).map((cost) => <option key={cost.id} value={cost.id}>{cost.name}</option>)}</select></label>}
        <label><span>Amount</span><div className="money-input"><b>৳</b><input name="amount" type="number" inputMode="decimal" min={entry.entry_type === 'adjustment' ? undefined : '0.01'} step="0.01" defaultValue={entry.amount} required autoFocus /></div></label>
        {entry.category !== 'cash_sales' && <label><span>Optional Note</span><textarea name="description" defaultValue={entry.description || ''} maxLength="500" rows="2" /></label>}
        <ActionMessage state={state} /><div className="form-actions"><button type="button" className="button ghost" onClick={onClose}>Cancel</button><SubmitButton>Save Changes</SubmitButton></div>
      </form>
    </div>
  </div>
}

export function EntryTable({ entries, category = null, admin = false, options = {}, totals = null }) {
  const [editing, setEditing] = useState(null)
  const config = category ? historyCategories[category] : null
  const columns = ['Date & Time', ...(!config ? ['Section', 'Name', 'Entry Type'] : config.party ? [config.party] : config.name ? [config.name] : []), ...(config?.primary ? [config.primary, config.secondary] : [config?.amount || 'Amount']), ...(admin ? ['Actions'] : [])]
  const totalLabelColumns = columns.length - (config?.primary ? 2 : 1) - (admin ? 1 : 0)
  return <>
    <div className="data-table-wrap ledger-table-wrap"><table className="data-table ledger-table"><thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>
      {entries.map((entry) => <tr key={`${entry.source}-${entry.id}`}>
        <td><time dateTime={entry.created_at}>{dateTime(entry.created_at)}</time>{entry.business_date !== businessDate(new Date(entry.created_at)) && <small className="history-note">Report: {formatDate(entry.business_date)}</small>}{admin && entry.updated_at && entry.updated_at !== entry.created_at && <small className="history-note">Edited {dateTime(entry.updated_at)}</small>}</td>
        {!config && <><td>{historyCategories[entry.category]?.title}</td><td>{entry.party_name || '—'}</td><td>{typeLabels[entry.entry_type] || historyCategories[entry.category]?.title}</td></>}
        {config?.party && <td>{entry.party_name}</td>}{config?.name && <td>{entry.party_name}</td>}
        {config?.primary ? <><td className="number-cell">{entry.entry_type === config.primaryType ? taka(entry.amount) : '—'}</td><td className="number-cell">{entry.entry_type !== config.primaryType ? taka(entry.amount) : '—'}</td></> : <td className="number-cell">{taka(entry.amount)}{entry.entry_type === 'previous_total' && <small className="history-note">Previous daily total</small>}{entry.entry_type === 'adjustment' && <small className="history-note">Adjustment</small>}</td>}
        {admin && <td><button type="button" className="button secondary table-edit" aria-label={`Edit ${historyCategories[entry.category]?.title} entry ${entry.id}`} onClick={() => setEditing(entry)}><Pencil size={15} />Edit</button></td>}
      </tr>)}
    </tbody>{totals && <tfoot><tr><th colSpan={totalLabelColumns} scope="row">Total for all matching entries</th><td className="number-cell">{taka(totals.primary_total)}</td>{config?.secondary && <td className="number-cell">{taka(totals.secondary_total)}</td>}{admin && <td />}</tr></tfoot>}</table>{!entries.length && <div className="empty-state"><p>No entries match this selection.</p></div>}</div>
    {admin && editing && <EditEntry key={`${editing.source}-${editing.id}`} entry={editing} options={options} onClose={() => setEditing(null)} />}
  </>
}
