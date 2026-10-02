import { createClient } from '@/lib/supabase/server'
import { historyCategories, historyFilters, validHistoryDate, HISTORY_PAGE_SIZE } from '@/lib/history'

export async function getHistoryRows(category, params = {}, date = null) {
  const filters = historyFilters(params)
  const partyId = historyCategories[category]?.party ? filters.partyId : null
  const supabase = await createClient()
  const totalsResult = await supabase.rpc('entry_history_totals', {
    p_category: category, p_party_id: partyId, p_business_date: date,
  })
  if (totalsResult.error) throw new Error('Unable to load entry history. Make sure migration 006 is applied.')
  const totals = totalsResult.data?.[0] || { entry_count: 0, primary_total: 0, secondary_total: 0 }
  const pages = Math.max(1, Math.ceil(Number(totals.entry_count) / HISTORY_PAGE_SIZE))
  const page = Math.min(filters.page, pages)
  let query = supabase.from('entry_history').select('*')
    .order('created_at', { ascending: false }).order('source').order('id', { ascending: false })
    .range((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE - 1)
  if (partyId) query = query.eq('party_id', partyId)
  if (category) query = query.eq('category', category)
  if (date) query = query.eq('business_date', date)
  const { data: entries, error } = await query
  if (error) throw new Error('Unable to load entry history.')
  return { entries: entries || [], totals, page, pages, partyId, date }
}

export async function getAdminEntryOptions() {
  const supabase = await createClient()
  const results = await Promise.all([
    supabase.from('customers').select('id, name').order('name'),
    supabase.from('suppliers').select('id, name').order('name'),
    supabase.from('overhead_categories').select('id, name').order('name'),
  ])
  if (results.some((result) => result.error)) throw new Error('Unable to load entry options.')
  return { customers: results[0].data || [], suppliers: results[1].data || [], overhead: results[2].data || [] }
}

export async function getEntryHistory(category, params = {}, { admin = false } = {}) {
  const config = historyCategories[category]
  const supabase = await createClient()
  const [rows, options] = await Promise.all([
    getHistoryRows(category, params, admin ? validHistoryDate(params.date) : null),
    admin ? getAdminEntryOptions() : config.table
      ? supabase.from(config.table).select('id, name').order('name').then((result) => {
        if (result.error) throw new Error('Unable to load names.')
        return { [config.table]: result.data || [] }
      }) : Promise.resolve({}),
  ])
  return { ...rows, parties: options[config.table] || [], options }
}
