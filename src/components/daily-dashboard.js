import { Clock3 } from 'lucide-react'
import { dateTime, formatDate, taka } from '@/lib/format'
import { DailyEntryPortal } from '@/components/daily-entry-portal'

export function DailyDashboard({ data, admin = false }) {
  const count = data.cashEntries.length + data.transactions.length + data.customerEntries.length + data.supplierEntries.length
  return <div className="page-stack daily-page">
    <header className="hero-heading"><div><p className="eyebrow">Daily Entry Portal</p><h1>{formatDate(data.date, true)}</h1><p>{admin ? 'Add missing entries to Ozi Pharma’s report.' : 'Enter all of today’s Ozi Pharma accounts in one place.'}</p></div><span className={`status ${data.report?.status || 'draft'}`}>{data.report?.status || 'draft'}</span></header>
    <section className={`previous-cash-card card ${data.cashInHand > 0 ? 'positive' : data.cashInHand < 0 ? 'negative' : 'neutral'}`}><div><span>Cash in Hand</span><small>{data.cashBalanceDate ? `Running balance through ${formatDate(data.cashBalanceDate, true)}` : 'Starting balance · No submitted reports yet'}</small></div><strong>{taka(data.cashInHand)}</strong></section>
    <div className="daily-progress"><span><strong>{count}</strong> {admin ? 'entries in this report' : 'entries today'}</span>{data.report?.updated_at && <span><Clock3 size={15} />Updated {dateTime(data.report.updated_at)}</span>}</div>
    <DailyEntryPortal key={data.date} data={data} admin={admin} />
  </div>
}
