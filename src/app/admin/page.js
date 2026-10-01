import Link from 'next/link'
import { ArrowRight, ReceiptText } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { businessDate, formatDate, taka } from '@/lib/format'
import { summaryItems } from '@/components/stat-cards'

export const metadata = { title: 'Admin Overview' }
export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const supabase = await createClient()
  const today = businessDate()
  const monthStart = `${today.slice(0, 7)}-01`
  const [{ data: rows }, { data: todayReport }] = await Promise.all([
    supabase.from('admin_report_summary').select('*').gte('business_date', monthStart).lte('business_date', today),
    supabase.from('daily_reports').select('id').eq('business_date', today).maybeSingle(),
  ])
  const summaries = rows || []
  const todayTotals = summaries.find((row) => row.business_date === today) || {}
  let transactionCount = 0
  if (todayReport) {
    const { count } = await supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('daily_report_id', todayReport.id)
    transactionCount = count || 0
  }
  const monthly = summaries.reduce((acc, row) => {
    for (const key of ['cash_sales', 'credit_sales', 'credit_recovery', 'supplier_payments', 'cash_purchases', 'overhead_cost', 'conveyance']) acc[key] = (acc[key] || 0) + Number(row[key] || 0)
    return acc
  }, {})
  const monthExpenses = ['supplier_payments', 'cash_purchases', 'overhead_cost', 'conveyance'].reduce((sum, key) => sum + (monthly[key] || 0), 0)
  return <div className="page-stack"><header className="page-heading"><div><p className="eyebrow">Administration</p><h1>Financial Overview</h1><p>{formatDate(today, true)} · Live database totals</p></div></header><section><div className="section-heading"><h2>Today</h2><span>{transactionCount} transactions</span></div><div className="stat-grid admin-stats">{summaryItems.map(([key, label, tone]) => <article className={`stat-card ${tone}`} key={key}><span>Today’s {label}</span><strong>{taka(todayTotals[key])}</strong></article>)}</div></section><section><div className="section-heading"><h2>Current Month</h2></div><div className="metric-row"><article className="metric-card"><span>Cash Sales</span><strong>{taka(monthly.cash_sales)}</strong></article><article className="metric-card"><span>Credit Sales</span><strong>{taka(monthly.credit_sales)}</strong></article><article className="metric-card"><span>Recovery</span><strong>{taka(monthly.credit_recovery)}</strong></article><article className="metric-card"><span>Supplier Payments</span><strong>{taka(monthly.supplier_payments)}</strong></article><article className="metric-card"><span>Total Expenses</span><strong>{taka(monthExpenses)}</strong></article></div></section><div className="admin-shortcuts"><Link href="/admin/reports" className="card shortcut"><ReceiptText /><span><strong>Review daily reports</strong><small>Filter, inspect, and approve reports</small></span><ArrowRight /></Link><Link href="/admin/transactions" className="card shortcut"><ReceiptText /><span><strong>Browse transactions</strong><small>Search individual accounting entries</small></span><ArrowRight /></Link></div></div>
}
