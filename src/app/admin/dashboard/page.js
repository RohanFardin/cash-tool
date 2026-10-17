import { requireRole } from '@/lib/auth'
import { getDailyEntryPortal } from '@/lib/data'
import { businessDate } from '@/lib/format'
import { validHistoryDate } from '@/lib/history'
import { DailyDashboard } from '@/components/daily-dashboard'
import { ReportDateFilter } from '@/components/history-date-filter'

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
    <ReportDateFilter path="/admin/dashboard" date={date} today={today} />
    <DailyDashboard data={data} admin />
  </div>
}
