'use client'

import { useActionState, useState } from 'react'
import { setEntryEditingAction, renameUserAction } from '@/app/admin/settings/actions'
import { ActionMessage, SubmitButton } from '@/components/action-ui'

export function EntryEditingSetting({ enabled, available }) {
  const [state, action, pending] = useActionState(setEntryEditingAction, null)
  return <section className="card settings-section">
    <div className="section-heading"><h2>Entry Editing</h2><span className={`status ${enabled ? 'approved' : 'draft'}`}>{enabled ? 'On' : 'Off'}</span></div>
    <p className="helper-text">Turn on editing to show Edit buttons for saved entries. Turn it off when you finish making corrections.</p>
    {!available && <p className="notice error">Apply migration 013 to enable this setting.</p>}
    <form action={action} className="entry-form">
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <button type="submit" role="switch" aria-label="Entry editing" aria-checked={enabled} className={`button ${enabled ? 'primary' : 'secondary'} editing-switch`} disabled={pending || !available}>
        <span className="switch-track" aria-hidden="true"><span /></span>{pending ? 'Saving…' : enabled ? 'Turn Off Editing' : 'Turn On Editing'}
      </button>
      <ActionMessage state={state} />
    </form>
  </section>
}

export function UserNameSettings({ users }) {
  const [userId, setUserId] = useState('')
  const [state, action] = useActionState(renameUserAction, null)
  const selected = users.find((user) => user.id === userId)
  return <section id="user-names" className="card settings-section">
    <h2>Change User Name</h2>
    <p className="helper-text">Choose the display name shown in the app and on submitted reports. The sign-in username stays the same.</p>
    <form action={action} className="entry-form">
      <label><span>User Account</span><select name="user_id" value={userId} onChange={(event) => setUserId(event.target.value)} required><option value="" disabled>Select a user</option>{users.map((user) => <option key={user.id} value={user.id}>{user.username} — {user.full_name}</option>)}</select></label>
      <label><span>Display Name</span><input key={`${selected?.id}-${selected?.full_name}`} name="full_name" defaultValue={selected?.full_name || ''} maxLength="150" autoComplete="off" required /></label>
      <ActionMessage state={state} />
      {users.length ? <SubmitButton>Save User Name</SubmitButton> : <p className="helper-text">There are no user accounts to rename.</p>}
    </form>
  </section>
}
