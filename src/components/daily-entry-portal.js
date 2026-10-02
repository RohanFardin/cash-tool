'use client'

import Link from 'next/link'
import { useActionState, useEffect, useMemo, useState } from 'react'
import { Banknote, Bike, Building2, ReceiptText, Search, ShoppingBasket, UserRoundPlus, UsersRound } from 'lucide-react'
import { addCustomerAction, saveAmountEntryAction, saveCustomerLedgerAction, saveOverheadEntryAction, saveSupplierLedgerAction } from '@/app/actions'
import { CashSalesForm, SubmitReport } from '@/components/forms'
import { ActionMessage, SubmitButton } from '@/components/action-ui'
import { dateTime, taka } from '@/lib/format'

function Section({ id, icon: Icon, title, description, total, history, children }) {
  return <section id={id} className="entry-section card">
    <header className="entry-section-head"><span className="section-icon"><Icon size={22} /></span><div><h2>{title}</h2><p>{description}</p></div>{total !== undefined && <strong>{taka(total)}</strong>}</header>
    {children}
    <Link className="history-link" href={history}>View history →</Link>
  </section>
}

function EntryList({ entries, empty, name, type }) {
  return <div className="portal-entry-list compact">
    {entries.map((entry) => <article key={entry.id}><div><strong>{name(entry)}</strong>{type && <span>{type(entry)}</span>}<small>{dateTime(entry.created_at)} · Entered by {entry.creator_name}</small></div><b>{taka(entry.amount)}</b></article>)}
    {entries.length === 0 && <p className="portal-empty">{empty}</p>}
  </div>
}

function AmountInput() {
  return <label><span>Amount</span><div className="money-input"><b>৳</b><input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" required /></div></label>
}

function CustomerPanel({ customers, entries, locked }) {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [entryType, setEntryType] = useState('credit_sale')
  const [showAdd, setShowAdd] = useState(false)
  const [state, action] = useActionState(saveCustomerLedgerAction, null)
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
  return <Section id="credit" icon={UsersRound} title="Credit Sales" description="Select a customer, then record debt or money received." history="/credit-recovery">
    {!locked && <>
      <div className="customer-search-row"><label className="search-field"><Search size={18} /><input aria-label="Search customer name" value={search} onChange={(event) => { setSearch(event.target.value); setSelectedId('') }} placeholder="Search customer name" /></label><button type="button" className="button secondary square" onClick={() => setShowAdd((value) => !value)} aria-label="Add customer"><UserRoundPlus size={20} /></button></div>
      {!selected && search && <div className="search-results">{filtered.map((customer) => <button type="button" key={customer.id} onClick={() => { setSelectedId(String(customer.id)); setSearch(customer.name) }}><span>{customer.name}</span><small>Due {taka(customer.current_due)}</small></button>)}{filtered.length === 0 && <p>No customer found. Use the + button to add one.</p>}</div>}
      {showAdd && <form action={addAction} className="inline-add-form"><label><span>New Customer Name</span><input name="name" defaultValue={search} required autoFocus /></label><ActionMessage state={addState} /><div className="form-actions"><button type="button" className="button ghost" onClick={() => setShowAdd(false)}>Cancel</button><SubmitButton>Add Customer</SubmitButton></div></form>}
      {selected && <form key={'customer-' + selected.id} action={action} className="portal-entry-form">
        <input type="hidden" name="customer_id" value={selected.id} />
        <div className="selected-party"><span><strong>{selected.name}</strong><small>Current due: {taka(selected.current_due)}</small></span><button type="button" onClick={() => { setSelectedId(''); setSearch('') }}>Change</button></div>
        <div className="type-toggle"><label className="sale"><input type="radio" name="entry_type" value="credit_sale" checked={entryType === 'credit_sale'} onChange={() => setEntryType('credit_sale')} /><span>Credit Sale</span></label><label className="recovery"><input type="radio" name="entry_type" value="credit_recovery" checked={entryType === 'credit_recovery'} onChange={() => setEntryType('credit_recovery')} /><span>Recovery</span></label></div>
        <AmountInput /><label><span>Optional Note</span><input name="description" maxLength="500" /></label><ActionMessage state={state} /><SubmitButton>Add Entry</SubmitButton>
      </form>}
    </>}
    <EntryList entries={entries} empty="No credit entries today." name={(entry) => entry.party_name || 'Customer'} type={(entry) => entry.entry_type === 'credit_sale' ? 'Credit Sale' : 'Recovery'} />
  </Section>
}

function SupplierPanel({ suppliers, entries, locked }) {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [entryType, setEntryType] = useState('purchase')
  const [state, action] = useActionState(saveSupplierLedgerAction, null)
  const selected = suppliers.find((supplier) => String(supplier.id) === selectedId)
  const filtered = suppliers.filter((supplier) => supplier.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8)
  return <Section id="supplier" icon={Building2} title="Supplier" description="Select a company, then record a purchase or payment." history="/supplier">
    {!locked && (suppliers.length ? <>
      <label className="search-field"><Search size={18} /><input aria-label="Search company name" value={search} onChange={(event) => { setSearch(event.target.value); setSelectedId('') }} placeholder="Search company name" /></label>
      {!selected && search && <div className="search-results">{filtered.map((supplier) => <button type="button" key={supplier.id} onClick={() => { setSelectedId(String(supplier.id)); setSearch(supplier.name) }}><span>{supplier.name}</span><small>Due {taka(supplier.current_due)}</small></button>)}{!filtered.length && <p>No company found.</p>}</div>}
      {selected && <form key={'supplier-' + selected.id} action={action} className="portal-entry-form">
        <input type="hidden" name="supplier_id" value={selected.id} />
        <div className="selected-party"><span><strong>{selected.name}</strong><small>Current due: {taka(selected.current_due)}</small></span><button type="button" onClick={() => { setSelectedId(''); setSearch('') }}>Change</button></div>
        <div className="type-toggle"><label className="sale"><input type="radio" name="entry_type" value="purchase" checked={entryType === 'purchase'} onChange={() => setEntryType('purchase')} /><span>Purchase</span></label><label className="recovery"><input type="radio" name="entry_type" value="payment" checked={entryType === 'payment'} onChange={() => setEntryType('payment')} /><span>Payment</span></label></div>
        <AmountInput /><ActionMessage state={state} /><SubmitButton>Add Entry</SubmitButton>
      </form>}
    </> : <p className="notice error">No suppliers configured. Ask an administrator to add supplier companies.</p>)}
    <EntryList entries={entries} empty="No supplier entries today." name={(entry) => entry.party_name || 'Supplier'} type={(entry) => entry.entry_type === 'purchase' ? 'Purchase' : 'Payment'} />
  </Section>
}

function AmountPanel({ id, icon, title, description, category, entries, total, locked, history }) {
  const [state, action] = useActionState(saveAmountEntryAction, null)
  return <Section id={id} icon={icon} title={title} description={description} total={total} history={history}>
    {!locked && <form action={action} className="quick-amount-form"><input type="hidden" name="category" value={category} /><AmountInput /><SubmitButton>Add</SubmitButton><ActionMessage state={state} /></form>}
    <EntryList entries={entries} empty="No entries today." name={() => title} />
  </Section>
}

function OverheadPanel({ categories, entries, locked, total }) {
  const [state, action] = useActionState(saveOverheadEntryAction, null)
  return <Section id="overhead" icon={ReceiptText} title="Overhead Cost" description="Choose an administrator-approved cost type." total={total} history="/overhead-cost">
    {!locked && (categories.length ? <form action={action} className="quick-amount-form overhead-form"><label><span>Cost Type</span><select name="overhead_category_id" defaultValue="" required><option value="" disabled>Select cost</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><AmountInput /><SubmitButton>Add</SubmitButton><ActionMessage state={state} /></form> : <p className="notice error">No overhead options configured. Ask an administrator to add them.</p>)}
    <EntryList entries={entries} empty="No overhead costs today." name={(entry) => entry.name} />
  </Section>
}

export function DailyEntryPortal({ data }) {
  const locked = Boolean(data.report && data.report.status !== 'draft')
  const cashPurchases = data.transactions.filter((row) => row.category === 'cash_purchase')
  const overhead = data.transactions.filter((row) => row.category === 'overhead')
  const conveyance = data.transactions.filter((row) => row.category === 'conveyance')
  return <div className="daily-entry-portal">
    {locked && <div className="locked-banner"><strong>Report submitted</strong><span>Today's entries are read-only.</span><Link href="/summary">View today's summary →</Link></div>}
    <Section id="cash-sales" icon={Banknote} title="Cash Sales" description="Cash Earned Today" total={data.totals.cash_sales} history="/cash-sales"><CashSalesForm locked={locked} /><EntryList entries={data.cashEntries} empty="No cash sales entries today." name={(entry) => entry.entry_type === 'adjustment' ? 'Adjustment' : 'Cash Sales'} /></Section>
    <CustomerPanel customers={data.customers} entries={data.customerEntries} locked={locked} />
    <SupplierPanel suppliers={data.suppliers} entries={data.supplierEntries} locked={locked} />
    <AmountPanel id="local-supplier" icon={ShoppingBasket} title="Local Supplier" description="Cash purchases made locally today." category="cash_purchase" entries={cashPurchases} total={data.totals.cash_purchases} locked={locked} history="/local-supplier" />
    <OverheadPanel categories={data.overheadCategories} entries={overhead} locked={locked} total={data.totals.overhead_cost} />
    <AmountPanel id="conveyance" icon={Bike} title="Conveyance" description="Extra delivery and transport spending." category="conveyance" entries={conveyance} total={data.totals.conveyance} locked={locked} history="/conveyance" />
    <section className="submit-section card"><div><h2>Finish Today's Entry</h2><p>Saved entries are permanent. Submit when finished to close today's entry forms.</p></div><SubmitReport status={data.report?.status || 'draft'} /></section>
  </div>
}
