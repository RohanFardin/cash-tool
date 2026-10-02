import { createClient } from '@/lib/supabase/server'
import { historyCategories, historyFilters, HISTORY_PAGE_SIZE } from '@/lib/history'

export async function getEntryHistory(category, params) {
  const config = historyCategories[category]
  const filters = historyFilters(params)
  const partyId = config.party ? filters.partyId : null
  const supabase = await createClient()
  const [totalsResult, partiesResult] = await Promise.all([
    supabase.rpc('entry_history_totals', { p_category: category, p_party_id: partyId }),
    config.table ? supabase.from(config.table).select('id, name').order('name') : Promise.resolve({ data: [] }),
  ])
  if (totalsResult.error || partiesResult.error) throw new Error('Unable to load entry history. Make sure migration 005 is applied.')
  const totals = totalsResult.data?.[0] || { entry_count: 0, primary_total: 0, secondary_total: 0 }
  const pages = Math.max(1, Math.ceil(Number(totals.entry_count) / HISTORY_PAGE_SIZE))
  const page = Math.min(filters.page, pages)
  let query = supabase.from('entry_history').select('*').eq('category', category)
    .order('created_at', { ascending: false }).order('source').order('id', { ascending: false })
    .range((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE - 1)
  if (partyId) query = query.eq('party_id', partyId)
  const { data: entries, error } = await query
  if (error) throw new Error('Unable to load entry history.')
  return { entries: entries || [], parties: partiesResult.data || [], totals, page, pages, partyId }
}
