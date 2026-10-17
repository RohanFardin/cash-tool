import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { displayUserName } from '@/lib/format'
import { PasswordSettings } from '@/components/password-settings'
import { EntryEditingSetting, UserNameSettings } from '@/components/admin-preferences'

export const metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const { profile } = await requireRole('superadmin')
  const supabase = await createClient()
  const { data, error } = await supabase.from('profiles').select('id, full_name, username').eq('role', 'user').order('username')
  if (error) throw new Error('Unable to load user accounts.')
  const users = (data || []).map((user) => ({ ...user, full_name: displayUserName(user.full_name) }))
  return <div className="page-stack narrow">
    <header className="page-heading"><div><p className="eyebrow">Administration</p><h1>Settings</h1><p>Manage entry editing, user names and account passwords.</p></div></header>
    <EntryEditingSetting enabled={profile.entry_editing_enabled} available={profile.entry_editing_available} />
    <UserNameSettings users={users} />
    <PasswordSettings users={users} />
  </div>
}
