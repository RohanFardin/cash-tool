import Link from 'next/link'
import { Search, RotateCcw } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { formatDate, dateTime, taka } from '@/lib/format'

export const metadata = { title: 'Transactions' }
export const dynamic = 'force-dynamic'
const PAGE_SIZE = 30

export default async function TransactionsPage({ searchParams }) {
  const filters = await searchParams
  const page = Math.max(1, Number(filters.page) || 1)
  const supabase = await createClient()
  let query = supabase.from('transactions').select('*, daily_reports!inner(business_date, submitted_by, profiles!daily_reports_submitted_by_fkey(full_name))', { count: 'exact' }).order('created_at', { ascending: false })
  if (filters.date) query = query.eq('daily_reports.business_date', filters.date)
  if (filters.category) query = query.eq('category', filters.category)
  if (filters.name) query = query.ilike('name', `%${String(filters.name).slice(0, 100)}%`)
  if (filters.user) query = query.eq('daily_reports.submitted_by', filters.user)
  query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  const [{ data: rows, count, error }, { data: profiles }] = await Promise.all([query, supabase.from('profiles').select('id, full_name').order('full_name')])
  const totalPages = Math.max(1, Math.ceil((count || 0) / PAGE_SIZE))
  const base = new URLSearchParams(Object.entries(filters).filter(([key, value]) => key !== 'page' && value))
  return <div className="page-stack"><header className="page-heading"><div><p className="eyebrow">Administration</p><h1>All Transactions</h1><p>Search individual entries across all reports.</p></div></header><form className="card filter-bar"><label><span>Date</span><input type="date" name="date" defaultValue={filters.date || ''} /></label><label><span>Category</span><select name="category" defaultValue={filters.category || ''}><option value="">All categories</option>{['credit', 'supplier_payment', 'cash_purchase', 'overhead', 'conveyance'].map((c) => <option key={c} value={c}>{c.replaceAll('_', ' ')}</option>)}</select></label><label><span>Name</span><input name="name" defaultValue={filters.name || ''} placeholder="Search name" /></label><label><span>User</span><select name="user" defaultValue={filters.user || ''}><option value="">All users</option>{(profiles || []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label><div className="filter-actions"><button className="button primary"><Search size={17} />Search</button><Link className="button ghost" href="/admin/transactions"><RotateCcw size={17} />Reset</Link></div></form>{error ? <p className="notice error">Unable to load transactions.</p> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Category</th><th>Subtype</th><th>Name</th><th>Amount</th><th>Submitted By</th><th>Created</th></tr></thead><tbody>{(rows || []).map((row) => <tr key={row.id}><td data-label="Date">{formatDate(row.daily_reports?.business_date)}</td><td data-label="Category">{row.category.replaceAll('_', ' ')}</td><td data-label="Subtype">{row.transaction_subtype?.replaceAll('_', ' ') || '—'}</td><td data-label="Name"><strong>{row.name}</strong></td><td data-label="Amount">{taka(row.amount)}</td><td data-label="Submitted By">{row.daily_reports?.profiles?.full_name || '—'}</td><td data-label="Created">{dateTime(row.created_at)}</td></tr>)}</tbody></table>{!rows?.length && <div className="empty-state"><p>No transactions found.</p></div>}</div>}<nav className="pagination"><Link aria-disabled={page <= 1} className={page <= 1 ? 'button ghost disabled' : 'button ghost'} href={`?${base}&page=${page - 1}`}>Previous</Link><span>Page {page} of {totalPages}</span><Link aria-disabled={page >= totalPages} className={page >= totalPages ? 'button ghost disabled' : 'button ghost'} href={`?${base}&page=${page + 1}`}>Next</Link></nav></div>
}
