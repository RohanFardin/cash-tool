import { requireRole } from '@/lib/auth'
import { UserNavigation } from '@/components/navigation'
import { IdleLogout } from '@/components/idle-logout'

export default async function UserLayout({ children }) {
  const { profile } = await requireRole('user')
  return <div className="app-shell"><IdleLogout /><UserNavigation name={profile.full_name} /><main className="app-content">{children}</main></div>
}
