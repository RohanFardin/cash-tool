import { ClipboardCheck, Clock3 } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getTodayReport } from '@/lib/data'
import { getCashBalance } from '@/lib/cash-data'
import { formatDate, dateTime, taka } from '@/lib/format'
import { StatCards } from '@/components/stat-cards'

export const metadata = { title: 'Today’s Summary' }
export const dynamic = 'force-dynamic'

export default async function SummaryPage() {
  const { date, report, cashEntries, transactions, customerEntries, supplierEntries, totals } = await getTodayReport()
  if (!report || report.status === 'draft') redirect('/dashboard')
  const { cashInHand } = await getCashBalance(date)
  const count = cashEntries.length + transactions.length + customerEntries.length + supplierEntries.length
  return <div className="page-stack narrow"><header className="hero-heading summary-hero"><div><p className="eyebrow">Submitted Summary</p><h1>{formatDate(date, true)}</h1></div><ClipboardCheck size={34} /></header><section className={`previous-cash-card card ${cashInHand > 0 ? 'positive' : cashInHand < 0 ? 'negative' : 'neutral'}`}><div><span>Cash in Hand</span><small>Running balance through this report</small></div><strong>{taka(cashInHand)}</strong></section><StatCards values={totals} compact /><section className="card report-meta"><div><span>Transactions</span><strong>{count} entries</strong></div><div><span>Report Status</span><strong className={`status ${report.status}`}>{report.status}</strong></div>{report.submitted_at && <div><span><Clock3 size={16} />Submitted</span><strong>{dateTime(report.submitted_at)}</strong></div>}</section></div>
}
