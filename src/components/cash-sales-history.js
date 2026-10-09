import Link from 'next/link'
import { getCashSalesHistory } from '@/lib/cash-data'
import { formatDate, taka } from '@/lib/format'
import { historyUrl } from '@/lib/history'

export async function CashSalesHistory({ searchParams }) {
  const data = await getCashSalesHistory(await searchParams)
  return <div className="page-stack history-page">
    <header className="page-heading"><div><p className="eyebrow">History</p><h1>Cash Sales</h1><p>Daily sales and the running cash balance after each submitted report.</p></div><Link className="button secondary" href="/dashboard">Today's Dashboard</Link></header>
    <div className="history-totals card" aria-label="Totals for all submitted days">
      <div><span>Submitted Days</span><strong>{data.totals.report_count}</strong></div>
      <div><span>Total Sales</span><strong>{taka(data.totals.total_sales)}</strong></div>
      <div><span>Cash in Hand</span><strong>{taka(data.totals.cash_in_hand)}</strong></div>
    </div>
    <div className="data-table-wrap ledger-table-wrap"><table className="data-table ledger-table"><thead><tr><th scope="col">Date</th><th scope="col" className="number-cell">Total Sales</th><th scope="col" className="number-cell">Cash in Hand</th></tr></thead><tbody>
      {data.reports.map((report) => <tr key={report.id}><td><time dateTime={report.business_date}>{formatDate(report.business_date)}</time></td><td className="number-cell">{taka(report.total_sales)}</td><td className="number-cell">{taka(report.cash_in_hand)}</td></tr>)}
    </tbody><tfoot><tr><th scope="row">Total sales / Latest cash balance</th><td className="number-cell">{taka(data.totals.total_sales)}</td><td className="number-cell">{taka(data.totals.cash_in_hand)}</td></tr></tfoot></table>{!data.reports.length && <div className="empty-state"><p>No submitted reports yet.</p></div>}</div>
    {data.pages > 1 && <nav className="pagination" aria-label="Cash sales history pages">{data.page > 1 && <Link className="button secondary" href={historyUrl('/cash-sales', data.page - 1, null)}>Previous</Link>}<span>Page {data.page} of {data.pages}</span>{data.page < data.pages && <Link className="button secondary" href={historyUrl('/cash-sales', data.page + 1, null)}>Next</Link>}</nav>}
  </div>
}
