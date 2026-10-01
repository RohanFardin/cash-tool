'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { Banknote, Bike, Building2, Pencil, Plus, ReceiptText, Search, ShoppingBasket, Trash2, UserRoundPlus, UsersRound } from 'lucide-react'
import {
  addCustomerAction,
  deleteCustomerLedgerAction,
  deleteSupplierLedgerAction,
  deleteTransactionAction,
  saveAmountEntryAction,
  saveCustomerLedgerAction,
  saveOverheadEntryAction,
  saveSupplierLedgerAction,
} from '@/app/actions'
import { CashSalesForm, SubmitReport } from '@/components/forms'
import { ActionMessage, SubmitButton } from '@/components/action-ui'
import { taka } from '@/lib/format'

function Section({ id, icon: Icon, title, description, total, children }) {
  return <section id={id} className="entry-section card">
    <header className="entry-section-head"><span className="section-icon"><Icon size={22} /></span><div><h2>{title}</h2><p>{description}</p></div>{total !== undefined && <strong>{taka(total)}</strong>}</header>
    {children}
  </section>
}

function EntryActions({ onEdit, action, id }) {
  const [, deleteAction] = useActionState(action, null)
  return <div className="portal-entry-actions"><button type="button" className="icon-button" onClick={onEdit} aria-label="Edit entry"><Pencil size={17} /></button><form action={deleteAction} onSubmit={(event) => { if (!window.confirm('Delete this entry?')) event.preventDefault() }}><input type="hidden" name="id" value={id} /><button className="icon-button danger" aria-label="Delete entry"><Trash2 size={17} /></button></form></div>
}

function Creator({ name }) {
  return <small>Entered by {name}</small>
}

function CustomerPanel({ customers, entries, locked, totalSales, totalRecovery }) {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [entryType, setEntryType] = useState('credit_sale')
  const [editing, setEditing] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [state, action] = useActionState(saveCustomerLedgerAction, null)
  const [addState, addAction] = useActionState(addCustomerAction, null)
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return customers.filter((customer) => !term || customer.name.toLowerCase().includes(term)).slice(0, 8)
  }, [customers, search])
  const selected = customers.find((customer) => String(customer.id) === String(selectedId))
    || (addState?.customer && String(addState.customer.id) === String(selectedId)
      ? { ...addState.customer, current_due: 0 }
      : null)
  useEffect(() => {
    if (addState?.customer) {
      setSelectedId(String(addState.customer.id))
      setSearch(addState.customer.name)
      setShowAdd(false)
    }
  }, [addState])
  const startEdit = (entry) => {
    setEditing(entry)
    setSelectedId(String(entry.customer_id))
    setEntryType(entry.entry_type)
    setSearch(customers.find((customer) => customer.id === entry.customer_id)?.name || '')
  }
  return <Section id="credit" icon={UsersRound} title="Credit Sales / Recovery" description="Select a customer, then record debt or money received.">
    <div className="mini-totals"><span className="sale"><small>Sales</small><strong>{taka(totalSales)}</strong></span><span className="recovery"><small>Recovery</small><strong>{taka(totalRecovery)}</strong></span></div>
    {!locked && <>
      <div className="customer-search-row"><label className="search-field"><Search size={18} /><input value={search} onChange={(event) => { setSearch(event.target.value); setSelectedId('') }} placeholder="Search customer name" /></label><button type="button" className="button secondary square" onClick={() => setShowAdd((value) => !value)} aria-label="Add customer"><UserRoundPlus size={20} /></button></div>
      {!selected && search && <div className="search-results">{filtered.map((customer) => <button type="button" key={customer.id} onClick={() => { setSelectedId(String(customer.id)); setSearch(customer.name) }}><span>{customer.name}</span><small>Due {taka(customer.current_due)}</small></button>)}{filtered.length === 0 && <p>No customer found. Use the + button to add one.</p>}</div>}
      {showAdd && <form action={addAction} className="inline-add-form"><label><span>New Customer Name</span><input name="name" defaultValue={search} required autoFocus /></label><ActionMessage state={addState} /><div className="form-actions"><button type="button" className="button ghost" onClick={() => setShowAdd(false)}>Cancel</button><SubmitButton>Add Customer</SubmitButton></div></form>}
      {selected && <form key={editing?.id || `new-${selected.id}`} action={action} className="portal-entry-form"><input type="hidden" name="id" value={editing?.id || ''} /><input type="hidden" name="customer_id" value={selected.id} /><div className="selected-party"><span><strong>{selected.name}</strong><small>Current due: {taka(selected.current_due)}</small></span><button type="button" onClick={() => { setSelectedId(''); setSearch(''); setEditing(null) }}>Change</button></div><div className="type-toggle"><label className="sale"><input type="radio" name="entry_type" value="credit_sale" checked={entryType === 'credit_sale'} onChange={() => setEntryType('credit_sale')} /><span>Credit Sale</span></label><label className="recovery"><input type="radio" name="entry_type" value="credit_recovery" checked={entryType === 'credit_recovery'} onChange={() => setEntryType('credit_recovery')} /><span>Recovery</span></label></div><label><span>Amount</span><div className="money-input"><b>৳</b><input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" defaultValue={editing?.amount || ''} required /></div></label><label><span>Optional Note</span><input name="description" defaultValue={editing?.description || ''} maxLength="500" /></label><ActionMessage state={state} /><div className="form-actions">{editing && <button type="button" className="button ghost" onClick={() => setEditing(null)}>Cancel Edit</button>}<SubmitButton>{editing ? 'Update Entry' : 'Add Entry'}</SubmitButton></div></form>}
    </>}
    <div className="portal-entry-list">{entries.map((entry) => { const customer = customers.find((item) => item.id === entry.customer_id); const sale = entry.entry_type === 'credit_sale'; return <article key={entry.id}><div><strong>{customer?.name || 'Customer'}</strong><span className={sale ? 'entry-kind sale' : 'entry-kind recovery'}>{sale ? 'Credit Sale' : 'Recovery'}</span><Creator name={entry.creator_name} /></div><b className={sale ? 'sale-text' : 'recovery-text'}>{taka(entry.amount)}</b>{!locked && <EntryActions id={entry.id} action={deleteCustomerLedgerAction} onEdit={() => startEdit(entry)} />}</article>})}{entries.length === 0 && <p className="portal-empty">No credit entries today.</p>}</div>
  </Section>
}

function SupplierPanel({ suppliers, entries, locked, purchases, payments }) {
  const [selectedId, setSelectedId] = useState('')
  const [entryType, setEntryType] = useState('purchase')
  const [editing, setEditing] = useState(null)
  const [state, action] = useActionState(saveSupplierLedgerAction, null)
  const selected = suppliers.find((supplier) => String(supplier.id) === String(selectedId))
  const startEdit = (entry) => { setEditing(entry); setSelectedId(String(entry.supplier_id)); setEntryType(entry.entry_type) }
  return <Section id="supplier" icon={Building2} title="Supplier" description="Record medicine purchases and partial payments by company.">
    <div className="mini-totals"><span className="sale"><small>Purchases</small><strong>{taka(purchases)}</strong></span><span className="recovery"><small>Payments</small><strong>{taka(payments)}</strong></span></div>
    {!locked && <>{suppliers.length ? <div className="supplier-grid">{suppliers.map((supplier) => <button type="button" className={String(supplier.id) === String(selectedId) ? 'selected' : ''} key={supplier.id} onClick={() => { setSelectedId(String(supplier.id)); setEditing(null) }}><strong>{supplier.name}</strong><small>Due {taka(supplier.current_due)}</small></button>)}</div> : <p className="notice error">No suppliers configured. Ask an administrator to add supplier companies.</p>}{selected && <form key={editing?.id || `new-${selected.id}`} action={action} className="portal-entry-form"><input type="hidden" name="id" value={editing?.id || ''} /><input type="hidden" name="supplier_id" value={selected.id} /><div className="selected-party"><span><strong>{selected.name}</strong><small>Current due: {taka(selected.current_due)}</small></span></div><div className="type-toggle"><label className="sale"><input type="radio" name="entry_type" value="purchase" checked={entryType === 'purchase'} onChange={() => setEntryType('purchase')} /><span>Supplier Purchase</span></label><label className="recovery"><input type="radio" name="entry_type" value="payment" checked={entryType === 'payment'} onChange={() => setEntryType('payment')} /><span>Payment</span></label></div><label><span>Amount</span><div className="money-input"><b>৳</b><input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" defaultValue={editing?.amount || ''} required /></div></label><label><span>Optional Note</span><input name="description" defaultValue={editing?.description || ''} maxLength="500" /></label><ActionMessage state={state} /><div className="form-actions">{editing && <button type="button" className="button ghost" onClick={() => setEditing(null)}>Cancel Edit</button>}<SubmitButton>{editing ? 'Update Entry' : 'Add Entry'}</SubmitButton></div></form>}</>}
    <div className="portal-entry-list">{entries.map((entry) => { const supplier = suppliers.find((item) => item.id === entry.supplier_id); const purchase = entry.entry_type === 'purchase'; return <article key={entry.id}><div><strong>{supplier?.name || 'Supplier'}</strong><span className={purchase ? 'entry-kind sale' : 'entry-kind recovery'}>{purchase ? 'Purchase' : 'Payment'}</span><Creator name={entry.creator_name} /></div><b className={purchase ? 'sale-text' : 'recovery-text'}>{taka(entry.amount)}</b>{!locked && <EntryActions id={entry.id} action={deleteSupplierLedgerAction} onEdit={() => startEdit(entry)} />}</article>})}{entries.length === 0 && <p className="portal-empty">No supplier entries today.</p>}</div>
  </Section>
}

function AmountPanel({ id, icon, title, description, category, entries, total, locked }) {
  const [editing, setEditing] = useState(null)
  const [state, action] = useActionState(saveAmountEntryAction, null)
  return <Section id={id} icon={icon} title={title} description={description} total={total}>
    {!locked && <form key={editing?.id || 'new'} action={action} className="quick-amount-form"><input type="hidden" name="id" value={editing?.id || ''} /><input type="hidden" name="category" value={category} /><label><span>Amount</span><div className="money-input"><b>৳</b><input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" defaultValue={editing?.amount || ''} required /></div></label><SubmitButton>{editing ? 'Update' : 'Add'}</SubmitButton>{editing && <button type="button" className="button ghost" onClick={() => setEditing(null)}>Cancel</button>}<ActionMessage state={state} /></form>}
    <div className="portal-entry-list compact">{entries.map((entry) => <article key={entry.id}><div><strong>{title}</strong><Creator name={entry.creator_name} /></div><b>{taka(entry.amount)}</b>{!locked && <EntryActions id={entry.id} action={deleteTransactionAction} onEdit={() => setEditing(entry)} />}</article>)}{entries.length === 0 && <p className="portal-empty">No entries today.</p>}</div>
  </Section>
}

function OverheadPanel({ categories, entries, locked, total }) {
  const [editing, setEditing] = useState(null)
  const [state, action] = useActionState(saveOverheadEntryAction, null)
  return <Section id="overhead" icon={ReceiptText} title="Overhead Cost" description="Choose an administrator-approved cost type." total={total}>
    {!locked && (categories.length ? <form key={editing?.id || 'new'} action={action} className="quick-amount-form overhead-form"><input type="hidden" name="id" value={editing?.id || ''} /><label><span>Cost Type</span><select name="overhead_category_id" defaultValue={editing?.overhead_category_id || ''} required><option value="" disabled>Select cost</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label><span>Amount</span><div className="money-input"><b>৳</b><input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" defaultValue={editing?.amount || ''} required /></div></label><SubmitButton>{editing ? 'Update' : 'Add'}</SubmitButton>{editing && <button type="button" className="button ghost" onClick={() => setEditing(null)}>Cancel</button>}<ActionMessage state={state} /></form> : <p className="notice error">No overhead options configured. Ask an administrator to add them.</p>)}
    <div className="portal-entry-list compact">{entries.map((entry) => <article key={entry.id}><div><strong>{entry.name}</strong><Creator name={entry.creator_name} /></div><b>{taka(entry.amount)}</b>{!locked && <EntryActions id={entry.id} action={deleteTransactionAction} onEdit={() => setEditing(entry)} />}</article>)}{entries.length === 0 && <p className="portal-empty">No overhead costs today.</p>}</div>
  </Section>
}

export function DailyEntryPortal({ data }) {
  const locked = data.report && data.report.status !== 'draft'
  const cashPurchases = data.transactions.filter((row) => row.category === 'cash_purchase')
  const overhead = data.transactions.filter((row) => row.category === 'overhead')
  const conveyance = data.transactions.filter((row) => row.category === 'conveyance')
  return <div className="daily-entry-portal">
    {locked && <div className="locked-banner"><strong>Report submitted</strong><span>Today’s entries are now read-only. Only an administrator can make changes.</span></div>}
    <Section id="cash-sales" icon={Banknote} title="Cash Sales" description="Total cash sales earned today." total={data.totals.cash_sales}><CashSalesForm value={data.report?.cash_sales} locked={locked} /></Section>
    <CustomerPanel customers={data.customers} entries={data.customerEntries} locked={locked} totalSales={data.totals.credit_sales} totalRecovery={data.totals.credit_recovery} />
    <SupplierPanel suppliers={data.suppliers} entries={data.supplierEntries} locked={locked} purchases={data.totals.supplier_purchases} payments={data.totals.supplier_payments} />
    <AmountPanel id="local-supplier" icon={ShoppingBasket} title="Local Supplier" description="Cash purchases made locally today." category="cash_purchase" entries={cashPurchases} total={data.totals.cash_purchases} locked={locked} />
    <OverheadPanel categories={data.overheadCategories} entries={overhead} locked={locked} total={data.totals.overhead_cost} />
    <AmountPanel id="conveyance" icon={Bike} title="Conveyance" description="Extra delivery and transport spending." category="conveyance" entries={conveyance} total={data.totals.conveyance} locked={locked} />
    <section className="submit-section card"><div><h2>Finish Today’s Entry</h2><p>Review every amount carefully. You cannot edit or delete after submission.</p></div><SubmitReport status={data.report?.status || 'draft'} /></section>
  </div>
}
