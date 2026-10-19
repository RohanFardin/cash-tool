import { createClient } from '@/lib/supabase/server'
import { getCashBalance } from '@/lib/cash-data'

async function allRows(query) {
  const rows = []
  for (let offset = 0; ; ) {
    const { data, error } = await query.range(offset, offset + 999)
    if (error) throw new Error('Unable to load reports for download.')
    if (!data?.length) return rows
    rows.push(...data)
    // Supabase may cap the response below the requested page size.
    offset += data.length
  }
}

export async function getReportExportData({ from, to }) {
  const supabase = await createClient()
  const [reports, summaries, opening] = await Promise.all([
    allRows(supabase.from('daily_reports').select('id, business_date, status, cash_in_hand')
      .in('status', ['submitted', 'approved']).gte('business_date', from).lte('business_date', to).order('business_date')),
    allRows(supabase.from('admin_report_summary').select('*')
      .gte('business_date', from).lte('business_date', to).order('business_date')),
    getCashBalance(from, { before: true }),
  ])
  return { from, to, reports, summaries, openingCashInHand: opening.cashInHand }
}
