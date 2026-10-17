import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { displayUserName } from '@/lib/format'

export const getViewer = cache(async () => {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  // Selecting the row keeps sign-in working on projects awaiting the settings
  // migration. Missing edit-mode configuration always defaults to read-only.
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  return profile ? { user, profile: {
    id: profile.id, role: profile.role, full_name: displayUserName(profile.full_name),
    entry_editing_enabled: profile.entry_editing_enabled === true,
    entry_editing_available: typeof profile.entry_editing_enabled === 'boolean',
  } } : null
})

export async function requireUser() {
  const viewer = await getViewer()
  if (!viewer) redirect('/login')
  return viewer
}

export async function requireRole(role) {
  const viewer = await requireUser()
  if (viewer.profile.role !== role) redirect(viewer.profile.role === 'superadmin' ? '/admin/summary' : '/dashboard')
  return viewer
}
