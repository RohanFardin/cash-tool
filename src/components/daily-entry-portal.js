'use client'

import Link from 'next/link'
import { useActionState, useCallback, useEffect, useMemo, useState } from 'react'
import { Banknote, Bike, Building2, Calculator, Plus, ReceiptText, Search, ShoppingBasket, Trash2, UserRoundPlus, UsersRound } from 'lucide-react'
import { addCustomerAction, addSupplierAction } from '@/app/actions'
import { SubmitReport } from '@/components/forms'
import { ActionMessage, SubmitButton } from '@/components/action-ui'
import { dateTime, taka } from '@/lib/format'

function Section({ id, icon: Icon, title, description, total, history, children }) {
  return <section id={id} className="entry-section card">
    <header className="entry-section-head"><span className="section-icon"><Icon size={22} /></span><div><h2>{title}</h2><p>{description}</p></div>{total !== undefined && <strong>{taka(total)}</strong>}</header>
    {children}
    <Link className="history-link" href={history}>View history →</Link>
  </section>
}

function EntryList({ entries, empty, name, type, onDelete, locked }) {
  return <div className="portal-entry-list compact">
    {entries.map((entry) => <article key={entry.local_id || entry.id}><div><strong>{name(entry)}</strong>{type && <span>{type(entry)}</span>}<small>{entry.staged ? 'Temporary · Not submitted yet' : `${dateTime(entry.created_at)} · Entered by ${entry.creator_name}`}</small>{entry.phone_number && <small>Phone: {entry.phone_number}</small>}{entry.description && <small>Note: {entry.description}</small>}</div><b>{taka(entry.amount)}</b>{entry.staged && !locked && <button type="button" className="icon-button danger staged-delete" aria-label={`Delete temporary ${name(entry)} entry`} onClick={() => onDelete(entry.local_id)}><Trash2 size={18} /></button>}</article>)}
    {entries.length === 0 && <p className="portal-empty">{empty}</p>}
  </div>
}

function AmountInput({ label = 'Amount' }) {
  return <label><span>{label}</span><div className="money-input"><b>৳</b><input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" required /></div></label>
}

function addAmount(event, values, onAdd) {
  event.preventDefault()
  const form = event.currentTarget
  const input = new FormData(form)
  const amount = Math.round(Number(input.get('amount')) * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) return
  onAdd({ ...values(input), amount })
  form.reset()
}

function CashSalesPanel({ entries, total, locked, onAdd, onDelete }) {
  return <Section id="cash-sales" icon={Banknote} title="Cash Sales" description="Cash earned today. Entries remain temporary until final submission." total={total} history="/cash-sales">
    {!locked && <form onSubmit={(event) => addAmount(event, () => ({ kind: 'cash' }), onAdd)} className="quick-amount-form"><AmountInput label="Enter Amount" /><button type="submit" className="button primary">Add Cash Sales</button></form>}
    <EntryList entries={entries} empty="No cash sales entries today." name={(entry) => entry.entry_type === 'adjustment' ? 'Adjustment' : 'Cash Sales'} onDelete={onDelete} locked={locked} />
  </Section>
}

function CustomerPanel({ customers, entries, locked, onAdd, onDelete }) {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [entryType, setEntryType] = useState('credit_sale')
  const [showAdd, setShowAdd] = useState(false)
  const [addState, addAction] = useActionState(addCustomerAction, null)
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return customers.filter((customer) => !term || customer.name.toLowerCase().includes(term)).slice(0, 8)
  }, [customers, search])
  const selected = customers.find((customer) => String(customer.id) === selectedId)
    || (addState?.customer && String(addState.customer.id) === selectedId ? { ...addState.customer, current_due: 0 } : null)
  useEffect(() => {
    if (addState?.customer) {
      setSelectedId(String(addState.customer.id))
      setSearch(addState.customer.name)
      setShowAdd(false)
    }
  }, [addState])
  return <Section id="credit" icon={UsersRound} title="Due Amount" description="Select or add a person, then stage a due amount or recovery." history="/credit-recovery">
    {!locked && <>
      <div className="customer-search-row"><label className="search-field"><Search size={18} /><input aria-label="Search customer name" value={search} onChange={(event) => { setSearch(event.target.value); setSelectedId('') }} placeholder="Search customer name" /></label><button type="button" className="button secondary square" onClick={() => setShowAdd((value) => !value)} aria-label="Add customer"><UserRoundPlus size={20} /></button></div>
      {!selected && search && <div className="search-results">{filtered.map((customer) => <button type="button" key={customer.id} onClick={() => { setSelectedId(String(customer.id)); setSearch(customer.name) }}><span>{customer.name}</span><small>Due {taka(customer.current_due)}</small></button>)}{filtered.length === 0 && <p>No customer found. Use the + button to add one.</p>}</div>}
      {showAdd && <form action={addAction} className="inline-add-form"><label><span>Person Name</span><input name="name" defaultValue={search} maxLength="150" required autoFocus /></label><label><span>Phone Number</span><input name="phone_number" type="tel" inputMode="tel" maxLength="30" /></label><label><span>Notes</span><textarea name="notes" maxLength="500" rows="2" /></label><ActionMessage state={addState} /><div className="form-actions"><button type="button" className="button ghost" onClick={() => setShowAdd(false)}>Cancel</button><SubmitButton>Add Person</SubmitButton></div></form>}
      {selected && <form key={'customer-' + selected.id} onSubmit={(event) => addAmount(event, (input) => ({
        kind: 'customer', party_id: selected.id, party_name: selected.name, entry_type: entryType,
        phone_number: String(input.get('phone_number') || '').trim() || null,
        description: String(input.get('description') || '').trim() || null,
      }), onAdd)} className="portal-entry-form">
        <div className="selected-party"><span><strong>{selected.name}</strong><small>Current due: {taka(selected.current_due)}</small>{selected.phone_number && <small>{selected.phone_number}</small>}</span><button type="button" onClick={() => { setSelectedId(''); setSearch('') }}>Change</button></div>
        <div className="type-toggle"><label className="sale"><input type="radio" name="entry_type" value="credit_sale" checked={entryType === 'credit_sale'} onChange={() => setEntryType('credit_sale')} /><span>Due Amount</span></label><label className="recovery"><input type="radio" name="entry_type" value="credit_recovery" checked={entryType === 'credit_recovery'} onChange={() => setEntryType('credit_recovery')} /><span>Due Recovery</span></label></div>
        <AmountInput /><label><span>Phone Number</span><input name="phone_number" type="tel" inputMode="tel" maxLength="30" defaultValue={selected.phone_number || ''} placeholder="Optional contact number" /></label><label><span>Optional Note</span><input name="description" maxLength="500" defaultValue={selected.notes || ''} /></label><button type="submit" className="button primary">Add Temporary Entry</button>
      </form>}
    </>}
    <EntryList entries={entries} empty="No due entries today." name={(entry) => entry.party_name || 'Customer'} type={(entry) => entry.entry_type === 'credit_sale' ? 'Due Amount' : 'Due Recovery'} onDelete={onDelete} locked={locked} />
  </Section>
}

function SupplierPanel({ suppliers, entries, locked, onAdd, onDelete }) {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [entryType, setEntryType] = useState('purchase')
  const [showAdd, setShowAdd] = useState(false)
  const [addState, addAction] = useActionState(addSupplierAction, null)
  const selected = suppliers.find((supplier) => String(supplier.id) === selectedId)
    || (addState?.supplier && String(addState.supplier.id) === selectedId ? { ...addState.supplier, current_due: 0 } : null)
  const filtered = suppliers.filter((supplier) => supplier.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8)
  useEffect(() => {
    if (addState?.supplier) {
      setSelectedId(String(addState.supplier.id))
      setSearch(addState.supplier.name)
      setShowAdd(false)
    }
  }, [addState])
  return <Section id="supplier" icon={Building2} title="Supplier" description="Select or add a company, then stage a purchase or payment." history="/supplier">
    {!locked && <>
      <div className="customer-search-row"><label className="search-field"><Search size={18} /><input aria-label="Search company name" value={search} onChange={(event) => { setSearch(event.target.value); setSelectedId('') }} placeholder="Search company name" /></label><button type="button" className="button secondary square" onClick={() => setShowAdd((value) => !value)} aria-label="Add company"><Plus size={20} /></button></div>
      {!selected && search && <div className="search-results">{filtered.map((supplier) => <button type="button" key={supplier.id} onClick={() => { setSelectedId(String(supplier.id)); setSearch(supplier.name) }}><span>{supplier.name}</span><small>Due {taka(supplier.current_due)}</small></button>)}{!filtered.length && <p>No company found. Use the + button to add one.</p>}</div>}
      {showAdd && <form action={addAction} className="inline-add-form"><label><span>Company Name</span><input name="name" defaultValue={search} maxLength="150" required autoFocus /></label><label><span>Phone Number</span><input name="phone_number" type="tel" inputMode="tel" maxLength="30" /></label><label><span>Notes</span><textarea name="notes" maxLength="500" rows="2" /></label><ActionMessage state={addState} /><div className="form-actions"><button type="button" className="button ghost" onClick={() => setShowAdd(false)}>Cancel</button><SubmitButton>Add Company</SubmitButton></div></form>}
      {selected && <form key={'supplier-' + selected.id} onSubmit={(event) => addAmount(event, (input) => ({
        kind: 'supplier', party_id: selected.id, party_name: selected.name, entry_type: entryType,
        phone_number: String(input.get('phone_number') || '').trim() || null,
        description: String(input.get('description') || '').trim() || null,
      }), onAdd)} className="portal-entry-form">
        <div className="selected-party"><span><strong>{selected.name}</strong><small>Current due: {taka(selected.current_due)}</small>{selected.phone_number && <small>{selected.phone_number}</small>}</span><button type="button" onClick={() => { setSelectedId(''); setSearch('') }}>Change</button></div>
        <div className="type-toggle"><label className="sale"><input type="radio" name="entry_type" value="purchase" checked={entryType === 'purchase'} onChange={() => setEntryType('purchase')} /><span>Purchase</span></label><label className="recovery"><input type="radio" name="entry_type" value="payment" checked={entryType === 'payment'} onChange={() => setEntryType('payment')} /><span>Payment</span></label></div>
        <AmountInput /><label><span>Phone Number</span><input name="phone_number" type="tel" inputMode="tel" maxLength="30" defaultValue={selected.phone_number || ''} placeholder="Optional contact number" /></label><label><span>Optional Note</span><input name="description" maxLength="500" defaultValue={selected.notes || ''} /></label><button type="submit" className="button primary">Add Temporary Entry</button>
      </form>}
    </>}
    <EntryList entries={entries} empty="No supplier entries today." name={(entry) => entry.party_name || 'Supplier'} type={(entry) => entry.entry_type === 'purchase' ? 'Purchase' : 'Payment'} onDelete={onDelete} locked={locked} />
  </Section>
}

function AmountPanel({ id, icon, title, description, category, entries, total, locked, history, onAdd, onDelete }) {
  return <Section id={id} icon={icon} title={title} description={description} total={total} history={history}>
    {!locked && <form onSubmit={(event) => addAmount(event, () => ({ kind: 'transaction', category }), onAdd)} className="quick-amount-form"><AmountInput /><button type="submit" className="button primary">Add Temporary Entry</button></form>}
    <EntryList entries={entries} empty="No entries today." name={() => title} onDelete={onDelete} locked={locked} />
  </Section>
}

function OverheadPanel({ categories, entries, locked, total, onAdd, onDelete }) {
  return <Section id="overhead" icon={ReceiptText} title="Overhead Cost" description="Choose an administrator-approved cost type." total={total} history="/overhead-cost">
    {!locked && (categories.length ? <form onSubmit={(event) => addAmount(event, (input) => {
      const categoryId = Number(input.get('overhead_category_id'))
      const category = categories.find((item) => item.id === categoryId)
      return { kind: 'transaction', category: 'overhead', overhead_category_id: categoryId, name: category?.name || 'Overhead Cost' }
    }, onAdd)} className="quick-amount-form overhead-form"><label><span>Cost Type</span><select name="overhead_category_id" defaultValue="" required><option value="" disabled>Select cost</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><AmountInput /><button type="submit" className="button primary">Add Temporary Entry</button></form> : <p className="notice error">No overhead options configured. Ask an administrator to add them.</p>)}
    <EntryList entries={entries} empty="No overhead costs today." name={(entry) => entry.name || 'Overhead Cost'} onDelete={onDelete} locked={locked} />
  </Section>
}

function CashInHandCalculator({ totals, storedAmount, locked }) {
  const calculated = Math.round((Number(totals.cash_sales || 0) + Number(totals.credit_recovery || 0) - Number(totals.supplier_payments || 0) - Number(totals.cash_purchases || 0) - Number(totals.overhead_cost || 0) - Number(totals.conveyance || 0)) * 100) / 100
  const [preview, setPreview] = useState(null)
  useEffect(() => { setPreview(null) }, [calculated])
  const displayed = locked ? Number(storedAmount ?? calculated) : preview
  const tone = displayed > 0 ? 'positive' : displayed < 0 ? 'negative' : 'neutral'
  return <div className="cash-calculator">{displayed !== null && <div className={`cash-result ${tone}`}><span>{locked ? 'Submitted Cash in Hand' : "Today's Cash in Hand"}</span><strong>{taka(displayed)}</strong></div>}{!locked && <button type="button" className="button secondary full" onClick={() => setPreview(calculated)}><Calculator size={18} />Calculate Cash in Hand</button>}</div>
}

export function DailyEntryPortal({ data }) {
  const locked = Boolean(data.report && data.report.status !== 'draft')
  const [staged, setStaged] = useState([])
  useEffect(() => { if (locked) setStaged([]) }, [locked])
  const onAdd = useCallback((entry) => setStaged((current) => [...current, {
    ...entry, local_id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    staged: true, created_at: new Date().toISOString(), creator_name: 'Pending submission',
  }]), [])
  const onDelete = useCallback((id) => setStaged((current) => current.filter((entry) => entry.local_id !== id)), [])
  const clearStaged = useCallback(() => setStaged([]), [])
  const totals = useMemo(() => {
    const result = { ...data.totals }
    for (const entry of staged) {
      if (entry.kind === 'cash') result.cash_sales += entry.amount
      else if (entry.kind === 'customer' && entry.entry_type === 'credit_sale') result.credit_sales += entry.amount
      else if (entry.kind === 'customer') result.credit_recovery += entry.amount
      else if (entry.kind === 'supplier' && entry.entry_type === 'purchase') result.supplier_purchases += entry.amount
      else if (entry.kind === 'supplier') result.supplier_payments += entry.amount
      else if (entry.category === 'cash_purchase') result.cash_purchases += entry.amount
      else if (entry.category === 'overhead') result.overhead_cost += entry.amount
      else if (entry.category === 'conveyance') result.conveyance += entry.amount
    }
    return result
  }, [data.totals, staged])
  const rows = (kind, category) => staged.filter((entry) => entry.kind === kind && (!category || entry.category === category))
  const cashEntries = [...data.cashEntries, ...rows('cash')]
  const customerEntries = [...data.customerEntries, ...rows('customer')]
  const supplierEntries = [...data.supplierEntries, ...rows('supplier')]
  const cashPurchases = [...data.transactions.filter((row) => row.category === 'cash_purchase'), ...rows('transaction', 'cash_purchase')]
  const overhead = [...data.transactions.filter((row) => row.category === 'overhead'), ...rows('transaction', 'overhead')]
  const conveyance = [...data.transactions.filter((row) => row.category === 'conveyance'), ...rows('transaction', 'conveyance')]
  return <div className="daily-entry-portal">
    {locked && <div className="locked-banner"><strong>Report submitted</strong><span>Today's entries are read-only and cannot be deleted.</span><Link href="/summary">View today's summary →</Link></div>}
    {!locked && staged.length > 0 && <div className="staged-banner"><strong>{staged.length} temporary {staged.length === 1 ? 'entry' : 'entries'}</strong><span>Nothing below is stored until you submit the report.</span></div>}
    <CashSalesPanel entries={cashEntries} total={totals.cash_sales} locked={locked} onAdd={onAdd} onDelete={onDelete} />
    <CustomerPanel customers={data.customers} entries={customerEntries} locked={locked} onAdd={onAdd} onDelete={onDelete} />
    <SupplierPanel suppliers={data.suppliers} entries={supplierEntries} locked={locked} onAdd={onAdd} onDelete={onDelete} />
    <AmountPanel id="local-supplier" icon={ShoppingBasket} title="Local Supplier" description="Cash purchases made locally today." category="cash_purchase" entries={cashPurchases} total={totals.cash_purchases} locked={locked} history="/local-supplier" onAdd={onAdd} onDelete={onDelete} />
    <OverheadPanel categories={data.overheadCategories} entries={overhead} locked={locked} total={totals.overhead_cost} onAdd={onAdd} onDelete={onDelete} />
    <AmountPanel id="conveyance" icon={Bike} title="Conveyance" description="Extra delivery and transport spending." category="conveyance" entries={conveyance} total={totals.conveyance} locked={locked} history="/conveyance" onAdd={onAdd} onDelete={onDelete} />
    <section className="submit-section card"><div><h2>Finish Today's Entry</h2><p>Review or delete temporary entries, calculate cash in hand, then submit once to save everything.</p></div><div className="submit-actions"><CashInHandCalculator totals={totals} storedAmount={data.report?.cash_in_hand} locked={locked} /><SubmitReport status={data.report?.status || 'draft'} entries={staged} onSubmitted={clearStaged} /></div></section>
  </div>
}
