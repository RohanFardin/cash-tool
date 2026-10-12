const emptyTotals = () => ({ entry_count: 0, primary_total: 0, secondary_total: 0 })

function historyError(operation, error) {
  console.error(operation, { code: error.code, message: error.message })
  return new Error('Unable to load entry history.', { cause: error })
}

export function filteredHistoryQuery(supabase, { category, partyId, from, to }, columns = '*') {
  let query = supabase.from('entry_history').select(columns)
  if (category) query = query.eq('category', category)
  if (partyId) query = query.eq('party_id', partyId)
  if (from) query = query.gte('business_date', from)
  if (to) query = query.lte('business_date', to)
  return query
}

async function totalsFromHistory(supabase, filters) {
  const totals = emptyTotals()
  let primaryCents = 0
  let secondaryCents = 0
  for (let offset = 0; ; ) {
    const { data, error } = await filteredHistoryQuery(supabase, filters, 'source, id, entry_type, amount')
      .order('source').order('id').range(offset, offset + 999)
    if (error) throw historyError('entry_history totals fallback', error)
    const rows = data || []
    if (!rows.length) break
    for (const row of rows) {
      const cents = Math.round(Number(row.amount) * 100)
      if (!Number.isFinite(cents)) throw new Error('Unable to read an entry amount.')
      if (['credit_recovery', 'payment'].includes(row.entry_type)) secondaryCents += cents
      else if (row.entry_type !== null && row.entry_type !== undefined) primaryCents += cents
    }
    totals.entry_count += rows.length
    // Advance by the rows actually received, even if the API caps a response
    // below 1,000. Totals must include every matching row, not just one page.
    offset += rows.length
  }
  totals.primary_total = primaryCents / 100
  totals.secondary_total = secondaryCents / 100
  return totals
}

export async function loadHistoryTotals(supabase, filters) {
  const { category, partyId, date, from, to } = filters
  const result = await supabase.rpc('entry_history_totals', {
    p_category: category, p_party_id: partyId, p_business_date: date,
    p_date_from: from, p_date_to: to,
  })
  if (!result.error) return result.data?.[0] || emptyTotals()
  if (result.error.code !== 'PGRST202') throw historyError('entry_history_totals', result.error)

  // Projects that have not applied migration 011 still expose the old RPC.
  // Its exact-date filter also supports a range containing a single day.
  if ((!from && !to) || (from && from === to)) {
    const previous = await supabase.rpc('entry_history_totals', {
      p_category: category, p_party_id: partyId, p_business_date: date || from || null,
    })
    if (!previous.error) return previous.data?.[0] || emptyTotals()
    if (previous.error.code !== 'PGRST202') throw historyError('entry_history_totals previous signature', previous.error)
  }

  // Multi-day filters cannot use the old RPC. Read the existing view with the
  // same filters and the signed-in user's permissions to calculate full totals.
  return totalsFromHistory(supabase, filters)
}
