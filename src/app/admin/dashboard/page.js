import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { getDailyEntryPortal } from '@/lib/data'
import { businessDate } from '@/lib/format'
import { validHistoryDate } from '@/lib/history'
import { DailyDashboard } from '@/components/daily-dashboard'

export const metadata = { title: 'Admin Daily Entry' }
export const dynamic = 'force-dynamic'

export default async function DashboardPage({ searchParams }) {
  await requireRole('superadmin')
  const filters = await searchParams || {}
  const today = businessDate()
  const selected = validHistoryDate(filters.date)
  const date = selected && selected <= today ? selected : today
  const data = await getDailyEntryPortal(date)
  return <div className="page-stack daily-page">
    <header className="page-heading"><div><p className="eyebrow">Administration</p><h1>Dashboard</h1><p>Add missed entries to today's report or select an earlier date.</p></div></header>
    <form action="/admin/dashboard" method="get" className="card history-filter"><label><span>Report Date</span><input type="date" name="date" defaultValue={date} max={today} required /></label><div className="filter-actions"><button className="button primary" type="submit">Apply</button><Link className="button ghost" href="/admin/dashboard">Today</Link></div></form>
    <DailyDashboard data={data} admin />
  </div>
}
