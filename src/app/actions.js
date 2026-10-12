'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { businessDate } from '@/lib/format'
import { requireRole, requireUser } from '@/lib/auth'
import { historyCategories, validHistoryDate } from '@/lib/history'

const usernamePattern = /^[a-z0-9._-]{2,40}$/

const ok = (message) => ({ ok: true, message })
const bad = (message) => ({ ok: false, message })

function amount(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return Math.round(number * 100) / 100
}

function clean(value, max = 250) {
  const result = String(value || '').trim()
  return result ? result.slice(0, max) : null
}

function refreshAccountingPages() {
  const paths = ['/dashboard', '/summary', ...Object.values(historyCategories).map((category) => category.path)]
  for (const prefix of ['', '/admin']) {
    for (const path of paths) revalidatePath(prefix + path)
  }
}

function stagedEntries(formData, admin = false) {
  const raw = String(formData.get('staged_entries') || '[]')
  if (raw.length > 250000) return { error: 'There are too many entries to save at once.' }
  let entries
  try { entries = JSON.parse(raw) } catch {
    return { error: 'The temporary entries could not be read. Please try again.' }
  }
  if (!Array.isArray(entries) || entries.length > 500 || (admin && !entries.length)) {
    return { error: admin ? 'Add between 1 and 500 entries before saving.' : 'The temporary entries are invalid.' }
  }
  return { entries }
}

export async function adminEditEntryAction(_previous, formData) {
  await requireRole('superadmin')
  const source = String(formData.get('source') || '')
  const id = positiveId(formData.get('id'))
  const rawAmount = Number(formData.get('amount'))
  if (!['cash', 'customer', 'supplier', 'transaction'].includes(source) || !id) return bad('That entry is not available.')
  if (!Number.isFinite(rawAmount) || rawAmount === 0) return bad('Enter a valid amount.')
  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('admin_edit_entry', {
      p_source: source, p_id: id, p_amount: Math.round(rawAmount * 100) / 100,
      p_party_id: positiveId(formData.get('party_id')),
      p_entry_type: clean(formData.get('entry_type'), 30),
      p_overhead_category_id: positiveId(formData.get('overhead_category_id')),
      p_description: clean(formData.get('description'), 500),
    })
    if (error) throw error
    refreshAccountingPages()
    return ok('Entry updated.')
  } catch (error) {
    console.error('adminEditEntryAction', error)
    return bad('Unable to update the entry. Check the amount and selected name or cost type.')
  }
}

export async function loginAction(_previous, formData) {
  const username = clean(formData.get('username'), 40)?.toLowerCase()
  const password = String(formData.get('password') || '')
  if (!usernamePattern.test(username || '') || !password) return bad('Enter a valid username and password.')

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: `${username}@pharmacy.local`, password,
  })
  if (error || !data.user) return bad('The username or password is incorrect.')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single()
  if (!profile) {
    await supabase.auth.signOut()
    return bad('Your account profile is not available. Contact an administrator.')
  }
  redirect(profile.role === 'superadmin' ? '/admin/summary' : '/dashboard')
}

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

function positiveId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

async function addParty(kind, formData, userId) {
  const customer = kind === 'customer'
  const name = clean(formData.get('name'), 150)
  if (!name) return bad(customer ? 'Enter the customer’s name.' : 'Enter the company name.')
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from(customer ? 'customers' : 'suppliers').insert({
      name, phone_number: clean(formData.get('phone_number'), 30),
      notes: clean(formData.get('notes'), 500), opening_due: 0, created_by: userId,
    }).select('id, name, phone_number, notes').single()
    if (error?.code === '23505') return bad(customer
      ? 'That customer already exists. Select the name from search.'
      : 'That company already exists. Select it from search.')
    if (error) throw error
    refreshAccountingPages()
    return { ...ok(data.name + ' added.'), [kind]: data }
  } catch (error) {
    console.error('addParty', kind, error)
    return bad(customer ? 'Unable to add the customer. Please try again.' : 'Unable to add the company. Please try again.')
  }
}

export async function addCustomerAction(_previous, formData) {
  const { user } = await requireUser()
  return addParty('customer', formData, user.id)
}

export async function addSupplierAction(_previous, formData) {
  const { user } = await requireUser()
  return addParty('supplier', formData, user.id)
}

export async function adminAddHistoryRecordAction(_previous, formData) {
  await requireRole('superadmin')
  const category = String(formData.get('category') || '')
  const config = historyCategories[category]?.add
  if (!config) return bad('This section does not support adding names.')
  const name = clean(formData.get('name'), 150)
  if (!name) return bad(`Enter the ${config.name.toLowerCase()}.`)
  const phoneNumber = config.types ? clean(formData.get('phone_number'), 30) : null
  const entryType = config.types ? clean(formData.get('entry_type'), 30) : null
  const rawAmount = config.types ? String(formData.get('amount') || '').trim() : ''
  const value = rawAmount ? amount(rawAmount) : null
  if (rawAmount && (value === null || value <= 0)) return bad('Enter an amount greater than zero or leave it blank.')
  if (entryType && !config.types.some(([type]) => type === entryType)) return bad('Select a valid entry type.')
  if (value !== null && !entryType) return bad('Select an entry type for the amount.')
  const reportDate = validHistoryDate(formData.get('business_date')) || businessDate()
  if (value !== null && reportDate > businessDate()) return bad('Select today or an earlier report date.')
  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('admin_add_history_record', {
      p_category: category, p_name: name, p_phone_number: phoneNumber,
      p_entry_type: entryType, p_amount: value,
      p_business_date: reportDate,
    })
    if (error?.code === '23505') return bad('That name already exists. Use the existing record.')
    if (error) throw error
    refreshAccountingPages()
    return { ...ok(`${name} added.`), entryRecorded: value !== null, businessDate: reportDate }
  } catch (error) {
    console.error('adminAddHistoryRecordAction', error)
    return bad('Unable to add this record. Please try again.')
  }
}

export async function submitReportAction(_previous, formData) {
  await requireRole('user')
  if (formData.get('confirm') !== 'yes') return bad('Please confirm report submission.')
  const { entries, error: entryError } = stagedEntries(formData)
  if (entryError) return bad(entryError)
  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('submit_staged_report', {
      p_business_date: businessDate(), p_entries: entries,
    })
    if (error) throw error
    refreshAccountingPages()
    return ok('Today’s report submitted successfully.')
  } catch (error) {
    console.error('submitReportAction', error)
    return bad('Unable to submit the report. Please try again.')
  }
}

export async function adminSaveReportEntriesAction(_previous, formData) {
  await requireRole('superadmin')
  if (formData.get('confirm') !== 'yes') return bad('Please confirm saving these entries.')
  const date = validHistoryDate(formData.get('business_date'))
  if (!date || date > businessDate()) return bad('Select today or an earlier report date.')
  const { entries, error: entryError } = stagedEntries(formData, true)
  if (entryError) return bad(entryError)
  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('admin_save_staged_report', { p_business_date: date, p_entries: entries })
    if (error) throw error
    refreshAccountingPages()
    return ok('Entries saved to the selected report.')
  } catch (error) {
    console.error('adminSaveReportEntriesAction', error)
    return bad('Unable to save these entries. Check the amounts and selected names.')
  }
}

export async function adminDeleteReportAction(_previous, formData) {
  await requireRole('superadmin')
  const id = positiveId(formData.get('report_id'))
  const date = validHistoryDate(formData.get('business_date'))
  if (!id || !date || date > businessDate()) return bad('Select a valid report date.')
  if (formData.get('confirm') !== 'yes' || formData.get('confirm_date') !== date) return bad('Type the selected report date to confirm deletion.')
  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('admin_delete_daily_report', { p_report_id: id, p_business_date: date })
    if (error?.code === 'PGRST202') return bad('Report deletion is not available yet. Apply the latest database migration.')
    if (error) throw error
    refreshAccountingPages()
    return ok(`The report and all entries for ${date} have been deleted.`)
  } catch (error) {
    console.error('adminDeleteReportAction', { code: error.code, message: error.message })
    return bad('Unable to delete this report. Reload the selected date and try again.')
  }
}
