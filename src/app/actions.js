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

async function ensureTodayReport(supabase, userId) {
  const today = businessDate()
  const { data: current } = await supabase.from('daily_reports').select('*').eq('business_date', today).maybeSingle()
  if (current) return current
  const { data, error } = await supabase.from('daily_reports').insert({
    business_date: today, submitted_by: userId, status: 'draft', cash_sales: 0,
  }).select().single()
  if (error?.code === '23505') {
    const { data: concurrent, error: concurrentError } = await supabase
      .from('daily_reports').select('*').eq('business_date', today).single()
    if (concurrentError) throw concurrentError
    return concurrent
  }
  if (error) throw error
  return data
}

function refreshUserPages() {
  ['/dashboard', '/cash-sales', '/credit-recovery', '/supplier', '/local-supplier', '/overhead-cost', '/conveyance', '/summary']
    .forEach((path) => revalidatePath(path))
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
  redirect(profile.role === 'superadmin' ? '/admin' : '/dashboard')
}

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function saveCashSalesAction(_previous, formData) {
  const { user } = await requireRole('user')
  const value = amount(formData.get('cash_sales'))
  if (value === null) return bad('Amount must be greater than zero.')
  try {
    const supabase = await createClient()
    const report = await ensureTodayReport(supabase, user.id)
    if (report.status !== 'draft') return bad('This report has been submitted and is locked.')
    const { error } = await supabase.from('cash_sales_entries').insert({
      daily_report_id: report.id, amount: value, created_by: user.id,
    })
    if (error) throw error
    refreshUserPages()
    return ok('Cash sales entry added.')
  } catch (error) {
    console.error('saveCashSalesAction', error)
    return bad('Unable to save cash sales. Please try again.')
  }
}

async function editableTodayReport(supabase, userId) {
  const report = await ensureTodayReport(supabase, userId)
  if (report.status !== 'draft') return { error: 'Today’s report has been submitted and is locked.' }
  return { report }
}

function positiveId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export async function addCustomerAction(_previous, formData) {
  const { user } = await requireRole('user')
  const name = clean(formData.get('name'), 150)
  if (!name) return bad('Enter the customer’s name.')
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from('customers').insert({
      name, opening_due: 0, created_by: user.id,
    }).select('id, name').single()
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

export async function saveCustomerLedgerAction(_previous, formData) {
  const { user } = await requireRole('user')
  if (formData.get('id')) return bad('Saved entries cannot be edited.')
  const customerId = positiveId(formData.get('customer_id'))
  const entryType = String(formData.get('entry_type') || '')
  const value = amount(formData.get('amount'))
  const description = clean(formData.get('description'), 500)
  if (!customerId) return bad('Select a customer first.')
  if (!['credit_sale', 'credit_recovery'].includes(entryType)) return bad('Select sale or recovery.')
  if (value === null) return bad('Amount must be greater than zero.')
  try {
    const supabase = await createClient()
    const [{ report, error: reportError }, customerResult] = await Promise.all([
      editableTodayReport(supabase, user.id),
      supabase.from('customers').select('id').eq('id', customerId).eq('active', true).maybeSingle(),
    ])
    if (reportError) return bad(reportError)
    if (!customerResult.data) return bad('That customer is not available.')
    const values = { customer_id: customerId, entry_type: entryType, amount: value, description }
    const { error } = await supabase.from('customer_ledger_entries').insert({
      ...values, daily_report_id: report.id, created_by: user.id, updated_by: user.id,
    })
    if (error) throw error
    refreshUserPages()
    return ok('Credit entry added.')
  } catch (error) {
    console.error('saveCustomerLedgerAction', error)
    return bad('Unable to save the credit entry. Please try again.')
  }
}

export async function deleteCustomerLedgerAction(_previous, formData) {
  await requireRole('user')
  return bad('Saved entries cannot be deleted.')
}

export async function saveSupplierLedgerAction(_previous, formData) {
  const { user } = await requireRole('user')
  if (formData.get('id')) return bad('Saved entries cannot be edited.')
  const supplierId = positiveId(formData.get('supplier_id'))
  const entryType = String(formData.get('entry_type') || '')
  const value = amount(formData.get('amount'))
  const description = clean(formData.get('description'), 500)
  if (!supplierId) return bad('Select a supplier first.')
  if (!['purchase', 'payment'].includes(entryType)) return bad('Select purchase or payment.')
  if (value === null) return bad('Amount must be greater than zero.')
  try {
    const supabase = await createClient()
    const [{ report, error: reportError }, supplierResult] = await Promise.all([
      editableTodayReport(supabase, user.id),
      supabase.from('suppliers').select('id').eq('id', supplierId).eq('active', true).maybeSingle(),
    ])
    if (reportError) return bad(reportError)
    if (!supplierResult.data) return bad('That supplier is not available.')
    const values = { supplier_id: supplierId, entry_type: entryType, amount: value, description }
    const { error } = await supabase.from('supplier_ledger_entries').insert({
      ...values, daily_report_id: report.id, created_by: user.id, updated_by: user.id,
    })
    if (error) throw error
    refreshUserPages()
    return ok('Supplier entry added.')
  } catch (error) {
    console.error('saveSupplierLedgerAction', error)
    return bad('Unable to save the supplier entry. Please try again.')
  }
}

export async function deleteSupplierLedgerAction(_previous, formData) {
  await requireRole('user')
  return bad('Saved entries cannot be deleted.')
}

export async function saveAmountEntryAction(_previous, formData) {
  const { user } = await requireRole('user')
  if (formData.get('id')) return bad('Saved entries cannot be edited.')
  const category = String(formData.get('category') || '')
  const value = amount(formData.get('amount'))
  if (!['cash_purchase', 'conveyance'].includes(category)) return bad('Invalid entry type.')
  if (value === null) return bad('Amount must be greater than zero.')
  try {
    const supabase = await createClient()
    const { report, error: reportError } = await editableTodayReport(supabase, user.id)
    if (reportError) return bad(reportError)
    const values = {
      category,
      transaction_subtype: null,
      name: category === 'cash_purchase' ? 'Local Supplier' : 'Conveyance',
      amount: value,
      description: null,
      overhead_category_id: null,
    }
    const { error } = await supabase.from('transactions').insert({
      ...values, daily_report_id: report.id, created_by: user.id, updated_by: user.id,
    })
    if (error) throw error
    refreshUserPages()
    return ok('Amount added.')
  } catch (error) {
    console.error('saveAmountEntryAction', error)
    return bad('Unable to save the amount. Please try again.')
  }
}

export async function saveOverheadEntryAction(_previous, formData) {
  const { user } = await requireRole('user')
  if (formData.get('id')) return bad('Saved entries cannot be edited.')
  const categoryId = positiveId(formData.get('overhead_category_id'))
  const value = amount(formData.get('amount'))
  if (!categoryId) return bad('Select an overhead cost.')
  if (value === null) return bad('Amount must be greater than zero.')
  try {
    const supabase = await createClient()
    const [{ report, error: reportError }, categoryResult] = await Promise.all([
      editableTodayReport(supabase, user.id),
      supabase.from('overhead_categories').select('id, name').eq('id', categoryId).eq('active', true).maybeSingle(),
    ])
    if (reportError) return bad(reportError)
    if (!categoryResult.data) return bad('That overhead option is not available.')
    const values = {
      category: 'overhead', transaction_subtype: null, name: categoryResult.data.name,
      amount: value, description: null, overhead_category_id: categoryId,
    }
    const { error } = await supabase.from('transactions').insert({
      ...values, daily_report_id: report.id, created_by: user.id, updated_by: user.id,
    })
    if (error) throw error
    refreshUserPages()
    return ok('Overhead cost added.')
  } catch (error) {
    console.error('saveOverheadEntryAction', error)
    return bad('Unable to save the overhead cost. Please try again.')
  }
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
  const { user } = await requireRole('user')
  if (formData.get('confirm') !== 'yes') return bad('Please confirm report submission.')
  try {
    const supabase = await createClient()
    const report = await ensureTodayReport(supabase, user.id)
    if (report.status !== 'draft') return bad('This report has already been submitted.')
    const { error } = await supabase.from('daily_reports').update({ status: 'submitted' }).eq('id', report.id)
    if (error) throw error
    refreshUserPages()
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
