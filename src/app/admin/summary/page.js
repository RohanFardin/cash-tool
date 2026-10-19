import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getAdminEntryOptions, getHistoryRows } from '@/lib/history-data'
import { historyUrl, validHistoryDate } from '@/lib/history'
import { businessDate, dateTime, displayUserName, formatDate, taka } from '@/lib/format'
import { summaryItems } from '@/components/stat-cards'
import { EntryTable } from '@/components/entry-table'
import { HistoryPagination } from '@/components/history-pagination'
import { DeleteReport } from '@/components/delete-report'
import { ReportDateFilter } from '@/components/history-date-filter'
import { requireRole } from '@/lib/auth'
import { SummaryCash } from '@/components/summary-cash'

export const metadata = { title: 'Daily Summary' }
export const dynamic = 'force-dynamic'

const summaryPaths = {
  cash_sales: '/admin/cash-sales', credit_sales: '/admin/credit-recovery', credit_recovery: '/admin/credit-recovery',
  supplier_purchases: '/admin/supplier', supplier_payments: '/admin/supplier', cash_purchases: '/admin/local-supplier',
  overhead_cost: '/admin/overhead-cost', conveyance: '/admin/conveyance',
}

export default async function SummaryPage({ searchParams }) {
  const { profile } = await requireRole('superadmin')
  const filters = await searchParams || {}
  const today = businessDate()
  const date = validHistoryDate(filters.date) || today
  const supabase = await createClient()
  const { data: report, error } = await supabase.from('daily_reports').select('*')
    .eq('business_date', date).in('status', ['submitted', 'approved']).maybeSingle()
  if (error) throw new Error('Unable to load the submitted report.')
  let data = null
  if (report) {
    const [rows, options, summary, submitter] = await Promise.all([
      getHistoryRows(null, filters, date), getAdminEntryOptions(),
      supabase.from('admin_report_summary').select('*').eq('id', report.id).single(),
      report.submitted_by ? supabase.from('profiles').select('id, full_name, username').eq('id', report.submitted_by).maybeSingle() : Promise.resolve({ data: null }),
    ])
    if (summary.error) throw new Error('Unable to load report totals.')
    if (submitter.error) throw new Error('Unable to load the report submitter.')
    data = { ...rows, options, summary: summary.data, submitter: submitter.data }
  }
  return <div className="page-stack history-page">
    <header className="page-heading"><div><p className="eyebrow">Administration</p><h1>Daily Summary</h1><p>One combined report for all users.</p></div><DeleteReport key={date} reportId={report?.id} date={date} count={Number(data?.totals.entry_count || 0)} /></header>
    <ReportDateFilter path="/admin/summary" date={date} today={today} />
    {!report ? <section className="card empty-state"><h2>{formatDate(date, true)}</h2><p>No submitted report for this date.</p><span>The shared report will appear after a user submits it.</span></section> : <>
      <div className="report-date-heading"><h2>{formatDate(date, true)}</h2><span className={`status ${report.status}`}>{report.status}</span></div>
      <SummaryCash date={date} />
      <dl className="card report-submission"><div><dt>Submitted by</dt><dd>{data.submitter ? displayUserName(data.submitter.full_name) : 'Unknown user'}{data.submitter?.username && <small>{data.submitter.username}</small>}</dd></div><div><dt>Submitted at</dt><dd>{report.submitted_at ? <time dateTime={report.submitted_at}>{dateTime(report.submitted_at)}</time> : 'Time not recorded'}</dd></div></dl>
      <p className="table-scroll-hint">Swipe the table to see Records →</p>
      <div className="data-table-wrap ledger-table-wrap summary-table-wrap" tabIndex={0} role="region" aria-label="Daily summary totals"><table className="data-table ledger-table summary-table"><thead><tr><th scope="col">Section</th><th scope="col" className="number-cell">Total Amount</th><th scope="col">Records</th></tr></thead><tbody>{summaryItems.map(([key, label]) => <tr key={key}><th scope="row">{key === 'cash_purchases' ? 'Local Supplier' : label}</th><td className="number-cell">{taka(data.summary[key])}</td><td><Link className="history-link" href={historyUrl(summaryPaths[key], 1, null, date)}>View entries</Link></td></tr>)}</tbody></table></div>
      <div className="section-heading"><h2>Submitted Entries</h2><span>{data.totals.entry_count} shared entries</span></div>
      <EntryTable entries={data.entries} admin canEdit={profile.entry_editing_enabled} options={data.options} />
      <HistoryPagination path="/admin/summary" data={data} date={date} label="Submitted entry pages" />
    </>}
  </div>
}
