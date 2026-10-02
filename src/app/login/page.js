import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { getViewer } from '@/lib/auth'
import { LoginForm } from '@/components/login-form'

export const metadata = { title: 'Sign in' }

export default async function LoginPage() {
  const viewer = await getViewer()
  if (viewer) redirect(viewer.profile.role === 'superadmin' ? '/admin/summary' : '/dashboard')
  return <main className="login-page"><section className="login-panel"><div className="login-brand"><span className="brand-mark large">Rx</span><div><h1>Pharmacy Accounts</h1><p>Secure daily financial reporting</p></div></div><div className="login-copy"><p className="eyebrow">Welcome back</p><h2>Sign in to continue</h2><p>Use the username and password provided by your administrator.</p></div><LoginForm /><p className="secure-note"><ShieldCheck size={17} />Protected by Supabase authentication</p></section><aside className="login-visual"><div><span>Simple. Accurate. Secure.</span><h2>Your pharmacy’s daily accounts, organized in one place.</h2><p>Enter transactions quickly from any phone and review every report with confidence.</p></div></aside></main>
}
