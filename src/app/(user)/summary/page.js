import { ClipboardCheck, Clock3 } from 'lucide-react'
import { getTodayReport } from '@/lib/data'
import { formatDate, dateTime } from '@/lib/format'
import { StatCards } from '@/components/stat-cards'
import { SubmitReport } from '@/components/forms'

export const metadata = { title: 'Today’s Summary' }
export const dynamic = 'force-dynamic'

export default async function SummaryPage() {
  const { date, report, transactions, customerEntries, supplierEntries, totals } = await getTodayReport()
  const count = transactions.length + customerEntries.length + supplierEntries.length
  return <div className="page-stack narrow"><header className="hero-heading summary-hero"><div><p className="eyebrow">Today</p><h1>{formatDate(date, true)}</h1></div><ClipboardCheck size={34} /></header><StatCards values={totals} compact /><section className="card report-meta"><div><span>Transactions</span><strong>{count} entries</strong></div><div><span>Report Status</span><strong className={`status ${report?.status || 'draft'}`}>{report?.status || 'draft'}</strong></div>{report?.updated_at && <div><span><Clock3 size={16} />Last Updated</span><strong>{dateTime(report.updated_at)}</strong></div>}</section><SubmitReport status={report?.status || 'draft'} /></div>
}
