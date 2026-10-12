import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { businessDate } from '@/lib/format'
import { historyFilters, historyDateRange, HISTORY_PAGE_SIZE } from '@/lib/history'
import { cumulativeCashReports } from '@/lib/cash'

// Existing projects can calculate balances before migration 009 is applied.
// Fetch every page and advance by the number received, including when Supabase
// limits responses to fewer rows than requested. Cache only within this render.
const getSubmittedCashReports = cache(async (date) => {
  const supabase = await createClient()
  const reports = []
  for (let offset = 0; ; ) {
    const { data, error } = await supabase.from('daily_reports')
      .select('id, business_date, status, cash_sales, cash_in_hand')
      .in('status', ['submitted', 'approved']).lte('business_date', date)
      .order('business_date').range(offset, offset + 999)
    if (error) throw new Error('Unable to load submitted reports for the running cash balance.')
    const batch = data || []
    if (!batch.length) break
    reports.push(...batch)
    offset += batch.length
  }
  return cumulativeCashReports(reports)
})

async function getReportCashSalesHistory(params) {
  const range = historyDateRange(params)
  const reports = (await getSubmittedCashReports(businessDate())).filter((report) =>
    (!range.from || report.business_date >= range.from) && (!range.to || report.business_date <= range.to)).toReversed()
  const totals = {
    report_count: reports.length,
    total_sales: reports.reduce((sum, report) => sum + Math.round(report.total_sales * 100), 0) / 100,
    cash_in_hand: reports[0]?.cash_in_hand || 0,
  }
  const pages = Math.max(1, Math.ceil(reports.length / HISTORY_PAGE_SIZE))
  const page = Math.min(historyFilters(params).page, pages)
  return { reports: reports.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE), totals, page, pages, ...range }
}

export async function getCashBalance(date, { before = false } = {}) {
  const supabase = await createClient()
  let query = supabase.from('daily_cash_balances').select('business_date, cash_in_hand')
  query = before ? query.lt('business_date', date) : query.lte('business_date', date)
  const { data, error } = await query.order('business_date', { ascending: false }).limit(1).maybeSingle()
  if (error?.code === 'PGRST205') {
    const reports = await getSubmittedCashReports(date)
    const latest = (before ? reports.filter((report) => report.business_date < date) : reports).at(-1)
    return { cashInHand: latest?.cash_in_hand || 0, asOfDate: latest?.business_date || null }
  }
  if (error) throw new Error('Unable to load the running cash balance.')
  return { cashInHand: Number(data?.cash_in_hand || 0), asOfDate: data?.business_date || null }
}

export async function getCashSalesHistory(params = {}) {
  const range = historyDateRange(params)
  if (range.rangeError) return { ...range, reports: [], totals: { report_count: 0, total_sales: 0, cash_in_hand: 0 }, page: 1, pages: 1 }
  const supabase = await createClient()
  const { data: totalsRows, error: totalsError } = await supabase.rpc('cash_sales_history_totals', { p_date_from: range.from, p_date_to: range.to })
  if (totalsError?.code === 'PGRST202') return getReportCashSalesHistory(params)
  if (totalsError) throw new Error('Unable to load cash sales totals.')
  const totals = totalsRows?.[0] || { report_count: 0, total_sales: 0, cash_in_hand: 0 }
  const pages = Math.max(1, Math.ceil(Number(totals.report_count) / HISTORY_PAGE_SIZE))
  const page = Math.min(historyFilters(params).page, pages)
  let query = supabase.from('daily_cash_balances').select('*')
    .lte('business_date', businessDate()).order('business_date', { ascending: false })
    .range((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE - 1)
  if (range.from) query = query.gte('business_date', range.from)
  if (range.to) query = query.lte('business_date', range.to)
  const { data, error } = await query
  if (error?.code === 'PGRST205') return getReportCashSalesHistory(params)
  if (error) throw new Error('Unable to load cash sales history.')
  return { reports: data || [], totals, page, pages, ...range }
}
