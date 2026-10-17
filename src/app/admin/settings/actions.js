'use server'

import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  if (!userIdPattern.test(userId)) return { ok: false, message: 'Select a user account.' }
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

export async function setEntryEditingAction(_previous, formData) {
  const { user, profile } = await requireRole('superadmin')
  if (!profile.entry_editing_available) return { ok: false, message: 'Apply the latest database migration to configure entry editing.' }
  const value = formData.get('enabled')
  if (!['true', 'false'].includes(value)) return { ok: false, message: 'Select a valid editing setting.' }
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from('profiles').update({ entry_editing_enabled: value === 'true' })
      .eq('id', user.id).eq('role', 'superadmin').select('entry_editing_enabled').single()
    if (error) throw error
    revalidatePath('/admin', 'layout')
    return { ok: true, enabled: data.entry_editing_enabled, message: data.entry_editing_enabled ? 'Entry editing is on.' : 'Entry editing is off.' }
  } catch (error) {
    console.error('setEntryEditingAction', { code: error.code })
    return { ok: false, message: 'Unable to change the editing setting. Please try again.' }
  }
}

export async function renameUserAction(_previous, formData) {
  await requireRole('superadmin')
  const userId = String(formData.get('user_id') || '')
  const name = typeof formData.get('full_name') === 'string' ? formData.get('full_name').trim() : ''
  if (!userIdPattern.test(userId)) return { ok: false, message: 'Select a user account.' }
  if (!name || name.length > 150 || /[\u0000-\u001f\u007f]/.test(name)) return { ok: false, message: 'Enter a display name between 1 and 150 characters.' }
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from('profiles').update({ full_name: name })
      .eq('id', userId).eq('role', 'user').select('id, full_name').maybeSingle()
    if (error) throw error
    if (!data) return { ok: false, message: 'Select an existing user account.' }
    revalidatePath('/', 'layout')
    return { ok: true, message: `${data.full_name} saved.` }
  } catch (error) {
    console.error('renameUserAction', { code: error.code })
    return { ok: false, message: 'Unable to change this user’s name. Please try again.' }
  }
}
