export const HISTORY_PAGE_SIZE = 50

export const historyCategories = {
  cash_sales: { title: 'Cash Sales', path: '/cash-sales', amount: 'Amount' },
  credit: { title: 'Due Amount / Due Recovery', path: '/credit-recovery', party: 'Person Name', table: 'customers', primary: 'Due Amount', secondary: 'Due Recovery', balance: 'Remaining Due Amount', primaryType: 'credit_sale' },
  supplier: { title: 'Supplier', path: '/supplier', party: 'Company Name', table: 'suppliers', primary: 'Purchases', secondary: 'Payments', primaryType: 'purchase' },
  cash_purchase: { title: 'Local Supplier', path: '/local-supplier', amount: 'Amount' },
  overhead: { title: 'Overhead Cost', path: '/overhead-cost', name: 'Overhead Name', amount: 'Cost Amount' },
  conveyance: { title: 'Conveyance', path: '/conveyance', amount: 'Conveyance' },
}

export function historyFilters(params = {}) {
  const party = typeof params.party === 'string' && /^[1-9]\d*$/.test(params.party) ? Number(params.party) : null
  const page = typeof params.page === 'string' && /^[1-9]\d*$/.test(params.page) ? Number(params.page) : 1
  return {
    partyId: Number.isSafeInteger(party) ? party : null,
    page: Number.isSafeInteger(page) ? page : 1,
  }
}

export function validHistoryDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

export function historyUrl(path, page, partyId, date = null) {
  const params = new URLSearchParams()
  if (partyId) params.set('party', String(partyId))
  if (date) params.set('date', date)
  if (page > 1) params.set('page', String(page))
  return params.size ? `${path}?${params}` : path
}
