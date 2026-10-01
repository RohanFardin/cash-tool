'use client'

import { useActionState } from 'react'
import { LockKeyhole, UserRound } from 'lucide-react'
import { loginAction } from '@/app/actions'
import { ActionMessage, SubmitButton } from '@/components/action-ui'

export function LoginForm() {
  const [state, action] = useActionState(loginAction, null)
  return (
    <form action={action} className="auth-form">
      <label><span>Username</span><div className="input-icon"><UserRound size={19} /><input name="username" autoComplete="username" autoCapitalize="none" required placeholder="Enter username" /></div></label>
      <label><span>Password</span><div className="input-icon"><LockKeyhole size={19} /><input name="password" type="password" autoComplete="current-password" required placeholder="Enter password" /></div></label>
      <ActionMessage state={state} />
      <SubmitButton className="button primary full" pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  )
}
