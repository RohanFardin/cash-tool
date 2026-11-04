import { requireRole } from '@/lib/auth'
import { AdminNavigation } from '@/components/navigation'
import { IdleLogout } from '@/components/idle-logout'

export default async function AdminLayout({ children }) {
  const { profile } = await requireRole('superadmin')
  return <div className="app-shell"><IdleLogout /><AdminNavigation name={profile.full_name} /><main className="app-content admin-content">{children}</main></div>
}
