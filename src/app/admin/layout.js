import { requireRole } from '@/lib/auth'
import { AdminNavigation } from '@/components/navigation'

export default async function AdminLayout({ children }) {
  const { profile } = await requireRole('superadmin')
  return <div className="app-shell"><AdminNavigation name={profile.full_name} /><main className="app-content admin-content">{children}</main></div>
}
