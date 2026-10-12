'use server'

import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function passwordInput(formData) {
  const password = formData.get('new_password')
  if (typeof password !== 'string' || password.length < 12 || new TextEncoder().encode(password).length > 72) {
    return { error: 'Use at least 12 characters and no more than 72 bytes for the new password.' }
  }
  if (password !== formData.get('confirm_password')) return { error: 'The new passwords do not match.' }
  return { password }
}

function passwordFailure(error) {
  if (error?.code === 'weak_password') return { ok: false, message: 'Choose a stronger password that meets the account password requirements.' }
  if (error?.code === 'same_password') return { ok: false, message: 'Choose a password different from the current password.' }
  // Auth errors can contain request details. Never log credentials or return them.
  console.error('Password update failed', { code: error?.code || 'unknown' })
  return { ok: false, message: 'Unable to change the password. Please try again.' }
}

export async function changeOwnPasswordAction(_previous, formData) {
  const { user } = await requireRole('superadmin')
  const { password, error } = passwordInput(formData)
  if (error) return { ok: false, message: error }
  const currentPassword = formData.get('current_password')
  if (typeof currentPassword !== 'string' || !currentPassword || !user.email) return { ok: false, message: 'Enter your current password.' }
  try {
    const supabase = await createClient()
    // A fresh sign-in verifies the current password and satisfies Supabase's
    // recent-login requirement without sending email to pharmacy.local accounts.
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword })
    if (signInError || data.user?.id !== user.id) return { ok: false, message: 'Your current password could not be verified.' }
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) return passwordFailure(updateError)
    return { ok: true, message: 'Your password has been changed.' }
  } catch (error) {
    return passwordFailure(error)
  }
}

export async function changeUserPasswordAction(_previous, formData) {
  await requireRole('superadmin')
  const { password, error } = passwordInput(formData)
  if (error) return { ok: false, message: error }
  const userId = String(formData.get('user_id') || '')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return { ok: false, message: 'Select a user account.' }
  try {
    const supabase = await createClient()
    const { data: profile, error: profileError } = await supabase.from('profiles').select('id')
      .eq('id', userId).eq('role', 'user').maybeSingle()
    if (profileError) throw profileError
    if (!profile) return { ok: false, message: 'Select an existing user account.' }
    const admin = createAdminClient()
    const { error: updateError } = await admin.auth.admin.updateUserById(profile.id, { password })
    if (updateError) return passwordFailure(updateError)
    return { ok: true, message: 'The user’s password has been changed.' }
  } catch (error) {
    if (error.message === 'User password changes are not configured.') return { ok: false, message: error.message }
    return passwordFailure(error)
  }
}
