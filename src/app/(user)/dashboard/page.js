import { Banknote, Bike, Building2, Clock3, ReceiptText, ShoppingBasket, UsersRound } from 'lucide-react'
import { getDailyEntryPortal } from '@/lib/data'
import { dateTime, formatDate } from '@/lib/format'
import { DailyEntryPortal } from '@/components/daily-entry-portal'

export const metadata = { title: 'Daily Entry' }
export const dynamic = 'force-dynamic'

const shortcuts = [
  ['cash-sales', 'Cash Sales', Banknote],
  ['credit', 'Credit', UsersRound],
  ['supplier', 'Supplier', Building2],
  ['local-supplier', 'Local', ShoppingBasket],
  ['overhead', 'Overhead', ReceiptText],
  ['conveyance', 'Conveyance', Bike],
]

export default async function DashboardPage() {
  const data = await getDailyEntryPortal()
  const count = data.transactions.length + data.customerEntries.length + data.supplierEntries.length
  return <div className="page-stack daily-page">
    <header className="hero-heading"><div><p className="eyebrow">Daily Entry Portal</p><h1>{formatDate(data.date, true)}</h1><p>Enter all of today’s pharmacy accounts in one place.</p></div><span className={`status ${data.report?.status || 'draft'}`}>{data.report?.status || 'draft'}</span></header>
    <nav className="entry-shortcuts" aria-label="Daily entry sections">{shortcuts.map(([id, label, Icon]) => <a key={id} href={`#${id}`}><Icon size={19} /><span>{label}</span></a>)}</nav>
    <div className="daily-progress"><span><strong>{count}</strong> entries today</span>{data.report?.updated_at && <span><Clock3 size={15} />Updated {dateTime(data.report.updated_at)}</span>}</div>
    <DailyEntryPortal data={data} />
  </div>
}
