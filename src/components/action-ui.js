'use client'

import { useFormStatus } from 'react-dom'

export function SubmitButton({ children, pendingText = 'Saving…', className = 'button primary' }) {
  const { pending } = useFormStatus()
  return <button type="submit" className={className} disabled={pending}>{pending ? pendingText : children}</button>
}

export function ActionMessage({ state }) {
  if (!state?.message) return null
  return <p className={`notice ${state.ok ? 'success' : 'error'}`} role="status">{state.message}</p>
}
