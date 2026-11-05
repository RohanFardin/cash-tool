'use client'

import { useActionState, useCallback, useEffect, useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { addSupplierAction, adminPurchasePaymentAction } from '@/app/actions'
import { historyUrl } from '@/lib/history'
import { ActionMessage, SubmitButton } from '@/components/action-ui'

function PurchasePaymentForm({ suppliers, date, onClose, onSaved }) {
  const [state, action, pending] = useActionState(adminPurchasePaymentAction, null)
  const [companies, setCompanies] = useState(suppliers)
  // Controlled so a rejected save keeps what was typed.
  const [values, setValues] = useState({ business_date: date, supplier_id: '', phone_number: '', purchase: '', payment: '' })
  const [newName, setNewName] = useState('')
  const [addState, setAddState] = useState(null)
  const [adding, startAdding] = useTransition()
  const heading = useId()
  const busy = pending || adding
  useEffect(() => { if (state?.ok) onSaved(state) }, [state, onSaved])
  useEffect(() => {
    const close = (event) => { if (event.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [onClose, busy])
  const field = (name) => ({ name, value: values[name], onChange: (event) => setValues((current) => ({ ...current, [name]: event.target.value })) })
  const select = (company) => {
    setValues((current) => ({ ...current, supplier_id: String(company.id), phone_number: company.phone_number || '' }))
    setNewName('')
  }
  function addCompany() {
    const name = newName.trim()
    if (!name || busy) return
    const existing = companies.find((company) => company.name.trim().toLowerCase() === name.toLowerCase())
    if (existing) {
      setAddState({ ok: true, message: `${existing.name} selected.` })
      return select(existing)
    }
    const phone = values.phone_number.trim()
    if (!phone) return setAddState({ ok: false, message: 'Enter the new company’s phone number.' })
    const input = new FormData()
    input.set('name', name)
    input.set('phone_number', phone)
    startAdding(async () => {
      const result = await addSupplierAction(null, input)
      setAddState(result)
      if (!result.supplier) return
      setCompanies((current) => [...current, result.supplier].sort((a, b) => a.name.localeCompare(b.name)))
      select(result.supplier)
    })
  }
  return <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby={heading}>
      <div className="modal-head"><h2 id={heading}>Purchase &amp; Payment</h2><button type="button" className="icon-button" aria-label="Close form" disabled={busy} onClick={onClose}><X /></button></div>
      <form action={action} className="entry-form">
        <p className="helper-text">Saved to the company account only. These amounts do not change Closing Balance.</p>
        <label><span>Date</span><input type="date" max={date} required {...field('business_date')} /></label>
        <label><span>Company Name</span><select required name="supplier_id" value={values.supplier_id} onChange={(event) => select(companies.find((company) => String(company.id) === event.target.value))}><option value="" disabled>Select company</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        <div className="company-add-row"><input aria-label="New company name" placeholder="New company name" maxLength="150" value={newName} onChange={(event) => { setNewName(event.target.value); setAddState(null); if (values.supplier_id) setValues((current) => ({ ...current, supplier_id: '', phone_number: '' })) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCompany() } }} /><button type="button" className="button secondary" disabled={busy || !newName.trim()} onClick={addCompany}><Plus size={18} />{adding ? 'Adding…' : 'Add'}</button></div>
        <label><span>Phone Number</span><input type="tel" inputMode="tel" maxLength="30" required={Boolean(newName.trim())} placeholder="Enter company phone number" {...field('phone_number')} />{values.supplier_id && <small className="helper-text">Press Save to update the company’s phone number. Amounts can be left blank.</small>}</label>
        <ActionMessage state={addState} />
        <div className="amount-pair">{[['purchase', 'Purchase'], ['payment', 'Payment']].map(([name, label]) => <label key={name}><span>{label}</span><div className="money-input"><b>৳</b><input type="number" inputMode="decimal" min="0.01" step="0.01" {...field(name)} /></div></label>)}</div>
        <ActionMessage state={state} /><div className="form-actions"><button type="button" className="button ghost" disabled={busy} onClick={onClose}>Cancel</button><SubmitButton>Save</SubmitButton></div>
      </form>
    </div>
  </div>
}

export function PurchasePayment({ suppliers, path, date }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState(null)
  const close = useCallback(() => setOpen(false), [])
  const saved = useCallback((value) => {
    setMessage({ ok: true, message: value.message })
    setOpen(false)
    router.replace(historyUrl(path, 1, null, value.businessDate))
  }, [path, router])
  return <div><button type="button" className="button secondary" onClick={() => { setMessage(null); setOpen(true) }}><Plus size={18} />Purchase &amp; Payment</button><ActionMessage state={message} />{open && <PurchasePaymentForm suppliers={suppliers} date={date} onClose={close} onSaved={saved} />}</div>
}
