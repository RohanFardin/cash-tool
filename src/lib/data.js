import { createClient } from '@/lib/supabase/server'
import { businessDate } from '@/lib/format'

export function totals(report, transactions = [], customerEntries = [], supplierEntries = []) {
  const result = {
    cash_sales: Number(report?.cash_sales || 0),
    credit_sales: 0,
    credit_recovery: 0,
    supplier_purchases: 0,
    supplier_payments: 0,
    cash_purchases: 0,
    overhead_cost: 0,
    conveyance: 0,
  }
  for (const row of transactions) {
    const value = Number(row.amount)
    if (row.category === 'credit' && row.transaction_subtype === 'credit_sale') result.credit_sales += value
    else if (row.category === 'credit') result.credit_recovery += value
    else if (row.category === 'supplier_payment') result.supplier_payments += value
    else if (row.category === 'cash_purchase') result.cash_purchases += value
    else if (row.category === 'overhead') result.overhead_cost += value
    else if (row.category === 'conveyance') result.conveyance += value
  }
  for (const row of customerEntries) {
    if (row.entry_type === 'credit_sale') result.credit_sales += Number(row.amount)
    else if (row.entry_type === 'credit_recovery') result.credit_recovery += Number(row.amount)
  }
  for (const row of supplierEntries) {
    if (row.entry_type === 'purchase') result.supplier_purchases += Number(row.amount)
    else if (row.entry_type === 'payment') result.supplier_payments += Number(row.amount)
  }
  return result
}

export async function getTodayReport() {
  const supabase = await createClient()
  const date = businessDate()
  const { data: report, error } = await supabase.from('daily_reports').select('*').eq('business_date', date).maybeSingle()
  if (error) throw new Error('Unable to load today’s report.')
  if (!report) {
    return {
      date, report: null, cashEntries: [], transactions: [], customerEntries: [], supplierEntries: [], totals: totals(null),
    }
  }
  const [transactionResult, customerResult, supplierResult, cashResult] = await Promise.all([
    supabase.from('transactions').select('*').eq('daily_report_id', report.id).order('created_at'),
    supabase.from('customer_ledger_entries').select('*, customers(name)').eq('daily_report_id', report.id).order('created_at'),
    supabase.from('supplier_ledger_entries').select('*, suppliers(name)').eq('daily_report_id', report.id).order('created_at'),
    supabase.from('cash_sales_entries').select('*').eq('daily_report_id', report.id).order('created_at'),
  ])
  if (transactionResult.error || customerResult.error || supplierResult.error || cashResult.error) {
    throw new Error('Unable to load today’s entries.')
  }
  const transactions = transactionResult.data || []
  const customerEntries = customerResult.data || []
  const supplierEntries = supplierResult.data || []
  return {
    date,
    report,
    cashEntries: cashResult.data || [],
    transactions,
    customerEntries,
    supplierEntries,
    totals: totals(report, transactions, customerEntries, supplierEntries),
  }
}

export async function getDailyEntryPortal() {
  const supabase = await createClient()
  const today = await getTodayReport()
  const [customersResult, suppliersResult, overheadResult, profilesResult] = await Promise.all([
    supabase.from('customer_balances').select('*').eq('active', true).order('name'),
    supabase.from('supplier_balances').select('*').eq('active', true).order('name'),
    supabase.from('overhead_categories').select('id, name').eq('active', true).order('name'),
    supabase.from('profiles').select('id, full_name, username'),
  ])
  if (customersResult.error || suppliersResult.error || overheadResult.error || profilesResult.error) {
    throw new Error('Unable to load daily entry options. Make sure migration 004 is applied.')
  }
  const names = new Map((profilesResult.data || []).map((profile) => [profile.id, profile.full_name || profile.username]))
  const addCreator = (rows) => rows.map((row) => ({
    ...row,
    party_name: row.customers?.name || row.suppliers?.name,
    creator_name: names.get(row.created_by) || 'Storekeeper',
  }))
  return {
    ...today,
    customers: customersResult.data || [],
    suppliers: suppliersResult.data || [],
    overheadCategories: overheadResult.data || [],
    customerEntries: addCreator(today.customerEntries),
    supplierEntries: addCreator(today.supplierEntries),
    transactions: addCreator(today.transactions),
    cashEntries: addCreator(today.cashEntries),
  }
}

export async function getReportDetail(id) {
  const supabase = await createClient()
  const { data: report, error } = await supabase.from('daily_reports')
    .select('*, profiles!daily_reports_submitted_by_fkey(full_name)').eq('id', id).single()
  if (error) return null
  const [{ data: transactions }, { data: customerEntries }, { data: supplierEntries }] = await Promise.all([
    supabase.from('transactions').select('*').eq('daily_report_id', id).order('created_at'),
    supabase.from('customer_ledger_entries').select('*').eq('daily_report_id', id).order('created_at'),
    supabase.from('supplier_ledger_entries').select('*').eq('daily_report_id', id).order('created_at'),
  ])
  return {
    report,
    transactions: transactions || [],
    customerEntries: customerEntries || [],
    supplierEntries: supplierEntries || [],
    totals: totals(report, transactions, customerEntries, supplierEntries),
  }
}
