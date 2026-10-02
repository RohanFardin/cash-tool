import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth'

export default async function Home() {
  const viewer = await getViewer()
  if (!viewer) redirect('/login')
  redirect(viewer.profile.role === 'superadmin' ? '/admin/summary' : '/dashboard')
}
