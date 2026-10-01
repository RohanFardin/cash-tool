import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const getViewer = cache(async () => {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  const { data: profile } = await supabase.from('profiles').select('id, full_name, role').eq('id', user.id).single()
  return profile ? { user, profile } : null
})

export async function requireUser() {
  const viewer = await getViewer()
  if (!viewer) redirect('/login')
  return viewer
}

export async function requireRole(role) {
  const viewer = await requireUser()
  if (viewer.profile.role !== role) redirect(viewer.profile.role === 'superadmin' ? '/admin' : '/dashboard')
  return viewer
}
