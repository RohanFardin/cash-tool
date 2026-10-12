import { getDailyEntryPortal } from '@/lib/data'
import { DailyDashboard } from '@/components/daily-dashboard'

export const metadata = { title: 'Daily Entry' }
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  return <DailyDashboard data={await getDailyEntryPortal()} />
}
