import Link from 'next/link'
import { Eye, Search, RotateCcw } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { formatDate, taka } from '@/lib/format'

export const metadata = { title: 'Daily Reports' }
export const dynamic = 'force-dynamic'

export default async function ReportsPage({ searchParams }) {
  const filters = await searchParams
  const supabase = await createClient()
  let query = supabase.from('daily_reports').select('*, profiles!daily_reports_submitted_by_fkey(full_name)').order('business_date', { ascending: false }).limit(100)
  if (filters.from) query = query.gte('business_date', filters.from)
  if (filters.to) query = query.lte('business_date', filters.to)
  if (['draft', 'submitted', 'approved'].includes(filters.status)) query = query.eq('status', filters.status)
  if (filters.user) query = query.eq('submitted_by', filters.user)
  const [{ data: reports, error }, { data: profiles }] = await Promise.all([query, supabase.from('profiles').select('id, full_name').order('full_name')])
  const ids = (reports || []).map((report) => report.id)
  const { data: summaries } = ids.length ? await supabase.from('admin_report_summary').select('*').in('id', ids) : { data: [] }
  const summaryMap = new Map((summaries || []).map((row) => [String(row.id), row]))
  return <div className="page-stack"><header className="page-heading"><div><p className="eyebrow">Administration</p><h1>Daily Reports</h1><p>Review financial totals and submission status by date.</p></div></header><form className="card filter-bar"><label><span>Date From</span><input type="date" name="from" defaultValue={filters.from || ''} /></label><label><span>Date To</span><input type="date" name="to" defaultValue={filters.to || ''} /></label><label><span>Status</span><select name="status" defaultValue={filters.status || ''}><option value="">All statuses</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="approved">Approved</option></select></label><label><span>Submitted By</span><select name="user" defaultValue={filters.user || ''}><option value="">All users</option>{(profiles || []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label><div className="filter-actions"><button className="button primary"><Search size={17} />Search</button><Link className="button ghost" href="/admin/reports"><RotateCcw size={17} />Reset</Link></div></form>{error ? <p className="notice error">Unable to load reports.</p> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Cash Sales</th><th>Credit Sales</th><th>Recovery</th><th>Supplier</th><th>Cash Purchase</th><th>Overhead</th><th>Conveyance</th><th>Status</th><th>Submitted By</th><th></th></tr></thead><tbody>{(reports || []).map((report) => { const s = summaryMap.get(String(report.id)) || {}; return <tr key={report.id}><td data-label="Date"><strong>{formatDate(report.business_date)}</strong></td><td data-label="Cash Sales">{taka(report.cash_sales)}</td><td data-label="Credit Sales">{taka(s.credit_sales)}</td><td data-label="Recovery">{taka(s.credit_recovery)}</td><td data-label="Supplier">{taka(s.supplier_payments)}</td><td data-label="Cash Purchase">{taka(s.cash_purchases)}</td><td data-label="Overhead">{taka(s.overhead_cost)}</td><td data-label="Conveyance">{taka(s.conveyance)}</td><td data-label="Status"><span className={`status ${report.status}`}>{report.status}</span></td><td data-label="Submitted By">{report.profiles?.full_name}</td><td><Link className="icon-button" href={`/admin/reports/${report.id}`}><Eye size={18} /></Link></td></tr>})}</tbody></table>{!reports?.length && <div className="empty-state"><p>No reports match these filters.</p></div>}</div>}</div>
}
