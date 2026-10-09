import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getAdminEntryOptions, getHistoryRows } from '@/lib/history-data'
import { getCashBalance } from '@/lib/cash-data'
import { historyUrl, validHistoryDate } from '@/lib/history'
import { businessDate, dateTime, formatDate, taka } from '@/lib/format'
import { summaryItems } from '@/components/stat-cards'
import { EntryTable } from '@/components/entry-table'

export const metadata = { title: 'Daily Summary' }
export const dynamic = 'force-dynamic'

const summaryPaths = {
  cash_sales: '/admin/cash-sales', credit_sales: '/admin/credit-recovery', credit_recovery: '/admin/credit-recovery',
  supplier_purchases: '/admin/supplier', supplier_payments: '/admin/supplier', cash_purchases: '/admin/local-supplier',
  overhead_cost: '/admin/overhead-cost', conveyance: '/admin/conveyance',
}

export default async function SummaryPage({ searchParams }) {
  const filters = await searchParams || {}
  const today = businessDate()
  const date = validHistoryDate(filters.date) || today
  const supabase = await createClient()
  const { data: report, error } = await supabase.from('daily_reports').select('*')
    .eq('business_date', date).in('status', ['submitted', 'approved']).maybeSingle()
  if (error) throw new Error('Unable to load the submitted report.')
  let data = null
  if (report) {
    const [rows, options, summary, cashBalance] = await Promise.all([
      getHistoryRows(null, filters, date), getAdminEntryOptions(),
      supabase.from('admin_report_summary').select('*').eq('id', report.id).single(),
      getCashBalance(date),
    ])
    if (summary.error) throw new Error('Unable to load report totals.')
    data = { ...rows, options, summary: summary.data, cashInHand: cashBalance.cashInHand }
  }
  return <div className="page-stack history-page">
    <header className="page-heading"><div><p className="eyebrow">Administration</p><h1>Daily Summary</h1><p>One combined report for all users.</p></div></header>
    <form method="get" action="/admin/summary" className="card history-filter"><label><span>Report Date</span><input type="date" name="date" defaultValue={date} max={today} required /></label><div className="filter-actions"><button type="submit" className="button primary">Apply</button><Link className="button ghost" href="/admin/summary">Today</Link></div></form>
    {!report ? <section className="card empty-state"><h2>{formatDate(date, true)}</h2><p>No submitted report for this date.</p><span>The shared report will appear after a user submits it.</span></section> : <>
      <div className="report-date-heading"><h2>{formatDate(date, true)}</h2><span className={`status ${report.status}`}>{report.status}</span>{report.submitted_at && <span className="muted">Submitted {dateTime(report.submitted_at)}</span>}</div>
      <div className="data-table-wrap ledger-table-wrap"><table className="data-table ledger-table summary-table"><thead><tr><th scope="col">Section</th><th scope="col" className="number-cell">Total Amount</th><th scope="col">Records</th></tr></thead><tbody>{summaryItems.map(([key, label]) => <tr key={key}><th scope="row">{key === 'cash_purchases' ? 'Local Supplier' : label}</th><td className="number-cell">{taka(data.summary[key])}</td><td><Link className="history-link" href={historyUrl(summaryPaths[key], 1, null, date)}>View entries</Link></td></tr>)}</tbody></table></div>
      <section className={`previous-cash-card card ${data.cashInHand > 0 ? 'positive' : data.cashInHand < 0 ? 'negative' : 'neutral'}`}><div><span>Cash in Hand</span><small>Running balance through this report</small></div><strong>{taka(data.cashInHand)}</strong></section>
      <div className="section-heading"><h2>Submitted Entries</h2><span>{data.totals.entry_count} shared entries</span></div>
      <EntryTable entries={data.entries} admin options={data.options} />
      {data.pages > 1 && <nav className="pagination" aria-label="Submitted entry pages">{data.page > 1 && <Link className="button secondary" href={historyUrl('/admin/summary', data.page - 1, null, date)}>Previous</Link>}<span>Page {data.page} of {data.pages}</span>{data.page < data.pages && <Link className="button secondary" href={historyUrl('/admin/summary', data.page + 1, null, date)}>Next</Link>}</nav>}
    </>}
  </div>
}
