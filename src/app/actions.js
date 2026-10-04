'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { businessDate } from '@/lib/format'
import { requireRole } from '@/lib/auth'

const categories = new Set(['credit', 'supplier_payment', 'cash_purchase', 'overhead', 'conveyance'])
const subtypes = new Set(['credit_sale', 'credit_recovery'])
const usernamePattern = /^[a-z0-9._-]{2,40}$/

const ok = (message) => ({ ok: true, message })
const bad = (message) => ({ ok: false, message })

function amount(value, allowZero = false) {
  const number = Number(value)
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) return null
  return Math.round(number * 100) / 100
}

function clean(value, max = 250) {
  const result = String(value || '').trim()
  return result ? result.slice(0, max) : null
}

function refreshUserPages() {
  ['/dashboard', '/cash-sales', '/credit-recovery', '/supplier', '/local-supplier', '/overhead-cost', '/conveyance', '/summary']
    .forEach((path) => revalidatePath(path))
}

function refreshAdminPages() {
  ['/admin/summary', '/admin/cash-sales', '/admin/credit-recovery', '/admin/supplier',
    '/admin/local-supplier', '/admin/overhead-cost', '/admin/conveyance']
    .forEach((path) => revalidatePath(path))
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
    refreshUserPages()
    refreshAdminPages()
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

export async function addCustomerAction(_previous, formData) {
  const { user } = await requireRole('user')
  const name = clean(formData.get('name'), 150)
  const phoneNumber = clean(formData.get('phone_number'), 30)
  const notes = clean(formData.get('notes'), 500)
  if (!name) return bad('Enter the customer’s name.')
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from('customers').insert({
      name, phone_number: phoneNumber, notes, opening_due: 0, created_by: user.id,
    }).select('id, name, phone_number, notes').single()
    if (error) {
      if (error.code === '23505') return bad('That customer already exists. Select the name from search.')
      throw error
    }
    refreshUserPages()
    return { ...ok(`${data.name} added.`), customer: data }
  } catch (error) {
    console.error('addCustomerAction', error)
    return bad('Unable to add the customer. Please try again.')
  }
}

export async function addSupplierAction(_previous, formData) {
  const { user } = await requireRole('user')
  const name = clean(formData.get('name'), 150)
  const phoneNumber = clean(formData.get('phone_number'), 30)
  const notes = clean(formData.get('notes'), 500)
  if (!name) return bad('Enter the company name.')
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from('suppliers').insert({
      name, phone_number: phoneNumber, notes, opening_due: 0, created_by: user.id,
    }).select('id, name, phone_number, notes').single()
    if (error) {
      if (error.code === '23505') return bad('That company already exists. Select it from search.')
      throw error
    }
    refreshUserPages()
    return { ...ok(`${data.name} added.`), supplier: data }
  } catch (error) {
    console.error('addSupplierAction', error)
    return bad('Unable to add the company. Please try again.')
  }
}

export async function deleteCustomerLedgerAction(_previous, formData) {
  await requireRole('user')
  return bad('Saved entries cannot be deleted.')
}

export async function deleteSupplierLedgerAction(_previous, formData) {
  await requireRole('user')
  return bad('Saved entries cannot be deleted.')
}

function transactionInput(formData) {
  const category = String(formData.get('category') || '')
  const name = clean(formData.get('name'), 150)
  const value = amount(formData.get('amount'))
  const description = clean(formData.get('description'), 500)
  let transaction_subtype = clean(formData.get('transaction_subtype'), 30)
  if (!categories.has(category)) return { error: 'Invalid transaction category.' }
  if (!name) return { error: 'Name is required.' }
  if (value === null) return { error: 'Amount must be greater than zero.' }
  if (category === 'credit' && !subtypes.has(transaction_subtype)) return { error: 'Select a credit transaction type.' }
  if (category !== 'credit') transaction_subtype = null
  return { category, name, amount: value, description, transaction_subtype }
}

export async function deleteTransactionAction(_previous, formData) {
  await requireRole('user')
  return bad('Saved entries cannot be deleted.')
}

export async function submitReportAction(_previous, formData) {
  await requireRole('user')
  if (formData.get('confirm') !== 'yes') return bad('Please confirm report submission.')
  const rawEntries = String(formData.get('staged_entries') || '[]')
  if (rawEntries.length > 250000) return bad('There are too many entries to submit at once.')
  let entries
  try {
    entries = JSON.parse(rawEntries)
  } catch {
    return bad('The temporary entries could not be read. Please try again.')
  }
  if (!Array.isArray(entries) || entries.length > 500) return bad('The temporary entries are invalid.')
  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('submit_staged_report', {
      p_business_date: businessDate(), p_entries: entries,
    })
    if (error) throw error
    refreshUserPages()
    refreshAdminPages()
    return ok('Today’s report submitted successfully.')
  } catch (error) {
    console.error('submitReportAction', error)
    return bad('Unable to submit the report. Please try again.')
  }
}

export async function approveReportAction(_previous, formData) {
  await requireRole('superadmin')
  try {
    const id = String(formData.get('id'))
    const supabase = await createClient()
    const { error } = await supabase.from('daily_reports').update({ status: 'approved' }).eq('id', id)
    if (error) throw error
    revalidatePath('/admin')
    revalidatePath('/admin/reports')
    revalidatePath(`/admin/reports/${id}`)
    return ok('Report approved and locked.')
  } catch (error) {
    console.error('approveReportAction', error)
    return bad('Unable to approve the report.')
  }
}

export async function adminUpdateReportAction(_previous, formData) {
  await requireRole('superadmin')
  const cashSales = amount(formData.get('cash_sales'), true)
  const status = String(formData.get('status') || '')
  if (cashSales === null) return bad('Cash sales must be zero or greater.')
  if (!['draft', 'submitted', 'approved'].includes(status)) return bad('Invalid report status.')
  try {
    const id = String(formData.get('id'))
    const supabase = await createClient()
    const { error } = await supabase.rpc('admin_update_daily_report', {
      p_report_id: id, p_cash_sales: cashSales, p_status: status,
      p_notes: clean(formData.get('notes'), 1000),
    })
    if (error) throw error
    revalidatePath('/admin')
    revalidatePath('/admin/reports')
    revalidatePath(`/admin/reports/${id}`)
    refreshUserPages()
    return ok('Report updated.')
  } catch (error) {
    console.error('adminUpdateReportAction', error)
    return bad('Unable to update the report.')
  }
}

export async function adminSaveTransactionAction(_previous, formData) {
  await requireRole('superadmin')
  const input = transactionInput(formData)
  if (input.error) return bad(input.error)
  try {
    const id = String(formData.get('id'))
    const reportId = String(formData.get('report_id'))
    const supabase = await createClient()
    const { error } = await supabase.from('transactions').update(input).eq('id', id)
    if (error) throw error
    revalidatePath('/admin')
    revalidatePath('/admin/reports')
    revalidatePath(`/admin/reports/${reportId}`)
    revalidatePath('/admin/transactions')
    return ok('Transaction updated.')
  } catch (error) {
    console.error('adminSaveTransactionAction', error)
    return bad('Unable to update the transaction.')
  }
}

export async function adminDeleteTransactionAction(_previous, formData) {
  await requireRole('superadmin')
  try {
    const id = String(formData.get('id'))
    const reportId = String(formData.get('report_id'))
    const supabase = await createClient()
    const { error } = await supabase.from('transactions').delete().eq('id', id)
    if (error) throw error
    revalidatePath(`/admin/reports/${reportId}`)
    revalidatePath('/admin/transactions')
    return ok('Transaction deleted.')
  } catch (error) {
    console.error('adminDeleteTransactionAction', error)
    return bad('Unable to delete the transaction.')
  }
}
