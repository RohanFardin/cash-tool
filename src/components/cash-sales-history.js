import Link from 'next/link'
import { getCashSalesHistory } from '@/lib/cash-data'
import { formatDate, taka } from '@/lib/format'
import { HistoryDateFilter } from '@/components/history-date-filter'
import { HistoryPagination } from '@/components/history-pagination'
import { getEntryHistory } from '@/lib/history-data'
import { EntryTable } from '@/components/entry-table'
import { requireRole } from '@/lib/auth'

export async function CashSalesHistory({ searchParams, admin = false }) {
  const canEdit = admin && (await requireRole('superadmin')).profile.entry_editing_enabled
  const params = await searchParams || {}
  const [data, entries] = await Promise.all([
    getCashSalesHistory(params), admin ? getEntryHistory('cash_sales', params, { admin }) : Promise.resolve(null),
  ])
  const path = admin ? '/admin/cash-sales' : '/cash-sales'
  return <div className="page-stack history-page">
    <header className="page-heading"><div><p className="eyebrow">{admin ? 'Administration' : 'History'}</p><h1>Cash Sales</h1><p>Daily sales and the running cash balance after each submitted report.</p></div><Link className="button secondary" href={admin ? '/admin/dashboard' : '/dashboard'}>Dashboard</Link></header>
    <HistoryDateFilter path={path} data={data} />
    {data.rangeError && <p className="notice error" role="alert">{data.rangeError}</p>}
    <div className="history-totals card" aria-label="Totals for all submitted days">
      <div><span>Submitted Days</span><strong>{data.totals.report_count}</strong></div>
      <div><span>Total Sales</span><strong>{taka(data.totals.total_sales)}</strong></div>
      <div><span>Cash in Hand</span><strong>{taka(data.totals.cash_in_hand)}</strong></div>
    </div>
    <div className="data-table-wrap ledger-table-wrap"><table className="data-table ledger-table cash-history-table"><thead><tr><th scope="col">Date</th><th scope="col" className="number-cell">Total Sales</th><th scope="col" className="number-cell">Cash in Hand</th></tr></thead><tbody>
      {data.reports.map((report) => <tr key={report.id}><td><time dateTime={report.business_date}>{formatDate(report.business_date)}</time></td><td className="number-cell">{taka(report.total_sales)}</td><td className="number-cell">{taka(report.cash_in_hand)}</td></tr>)}
    </tbody><tfoot><tr><th scope="row">Total sales / Latest cash balance</th><td className="number-cell">{taka(data.totals.total_sales)}</td><td className="number-cell">{taka(data.totals.cash_in_hand)}</td></tr></tfoot></table>{!data.reports.length && <div className="empty-state"><p>No submitted reports yet.</p></div>}</div>
    <HistoryPagination path={path} data={data} label="Cash sales history pages" />
    {admin && <><div className="section-heading"><h2>Individual Cash Entries</h2><span>{entries.totals.entry_count} entries</span></div><EntryTable entries={entries.entries} category="cash_sales" admin canEdit={canEdit} options={entries.options} totals={entries.totals} /><HistoryPagination path={path} data={entries} label="Individual cash entry pages" /></>}
  </div>
}
