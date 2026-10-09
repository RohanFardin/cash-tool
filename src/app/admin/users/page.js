import { createClient } from '@/lib/supabase/server'
import { dateTime, displayUserName } from '@/lib/format'

export const metadata = { title: 'Users' }
export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const supabase = await createClient()
  const { data: profiles, error } = await supabase.from('profiles').select('*').order('created_at')
  const users = profiles?.map((profile) => ({ ...profile, full_name: displayUserName(profile.full_name) }))
  return <div className="page-stack"><header className="page-heading"><div><p className="eyebrow">Administration</p><h1>Users</h1><p>Accounts are created securely through Supabase Authentication.</p></div></header>{error ? <p className="notice error">Unable to load users.</p> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Full Name</th><th>Role</th><th>Created</th><th>Updated</th></tr></thead><tbody>{(users || []).map((user) => <tr key={user.id}><td data-label="Full Name"><strong>{user.full_name}</strong></td><td data-label="Role"><span className={`status ${user.role === 'superadmin' ? 'approved' : 'draft'}`}>{user.role}</span></td><td data-label="Created">{dateTime(user.created_at)}</td><td data-label="Updated">{dateTime(user.updated_at)}</td></tr>)}</tbody></table></div>}<p className="helper-text">Create or reset passwords in Supabase Authentication. Promote trusted accounts with SQL only; client code cannot change roles.</p></div>
}
