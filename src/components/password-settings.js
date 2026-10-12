'use client'

import { useActionState, useEffect, useRef } from 'react'
import { changeOwnPasswordAction, changeUserPasswordAction } from '@/app/admin/settings/actions'
import { ActionMessage, SubmitButton } from '@/components/action-ui'

function PasswordForm({ own = false, users = [] }) {
  const [state, action] = useActionState(own ? changeOwnPasswordAction : changeUserPasswordAction, null)
  const form = useRef(null)
  useEffect(() => { if (state?.ok) form.current?.reset() }, [state])
  return <section className="card">
    <h2>{own ? 'Change My Password' : 'Change User Password'}</h2>
    <form ref={form} action={action} className="entry-form">
      {own ? <label><span>Current Password</span><input type="password" name="current_password" autoComplete="current-password" required /></label>
        : <label><span>User Account</span><select name="user_id" defaultValue="" required><option value="" disabled>Select a user</option>{users.map((user) => <option key={user.id} value={user.id}>{user.username ? `${user.username} — ${user.full_name}` : user.full_name}</option>)}</select></label>}
      <label><span>New Password</span><input type="password" name="new_password" autoComplete="new-password" minLength="12" maxLength="72" required /></label>
      <label><span>Confirm New Password</span><input type="password" name="confirm_password" autoComplete="new-password" minLength="12" maxLength="72" required /></label>
      <p className="helper-text">Use at least 12 characters.</p>
      <ActionMessage state={state} />
      {own || users.length ? <SubmitButton>{own ? 'Change My Password' : 'Change User Password'}</SubmitButton> : <p className="helper-text">There are no user accounts to update.</p>}
    </form>
  </section>
}

export function PasswordSettings({ users }) {
  return <><PasswordForm own /><PasswordForm users={users} /></>
}
