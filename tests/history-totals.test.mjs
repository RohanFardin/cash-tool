import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHistoryTotals } from '../src/lib/history-totals.js'

const missing = { code: 'PGRST202', message: 'Function signature not found in schema cache' }
const filters = { category: 'credit', partyId: null, date: null, from: null, to: null }

function clientFor({ rpc, rows = [], cap = 1000, viewError = null }) {
  const calls = []
  const offsets = []
  const client = {
    calls, offsets,
    async rpc(name, args) { calls.push({ name, args }); return rpc(args) },
    from(table) {
      assert.equal(table, 'entry_history')
      let selected = rows
      const query = {
        select() { return query },
        eq(field, value) { selected = selected.filter((row) => row[field] === value); return query },
        gte(field, value) { selected = selected.filter((row) => row[field] >= value); return query },
        lte(field, value) { selected = selected.filter((row) => row[field] <= value); return query },
        order() { return query },
        async range(from, to) { offsets.push(from); return { data: selected.slice(from, Math.min(to + 1, from + cap)), error: viewError } },
      }
      return query
    },
  }
  return client
}

test('the current RPC supplies complete totals without reading the history view', async () => {
  const totals = { entry_count: 1001, primary_total: '300.00', secondary_total: '125.00' }
  const client = clientFor({ rpc: () => ({ data: [totals] }) })
  assert.deepEqual(await loadHistoryTotals(client, filters), totals)
  assert.equal(client.calls.length, 1)
  assert.deepEqual(client.offsets, [])
})

test('the old three-argument function keeps unfiltered history loading', async () => {
  const totals = { entry_count: 2, primary_total: '100.00', secondary_total: '50.00' }
  const client = clientFor({ rpc: (args) => 'p_date_from' in args ? { error: missing } : { data: [totals] } })
  assert.deepEqual(await loadHistoryTotals(client, { ...filters, partyId: 3 }), totals)
  assert.deepEqual(client.calls[1].args, { p_category: 'credit', p_party_id: 3, p_business_date: null })
  assert.deepEqual(client.offsets, [])
})

test('a single-day range uses the older exact-date argument', async () => {
  const client = clientFor({ rpc: (args) => 'p_date_from' in args ? { error: missing } : { data: [{ entry_count: 1, primary_total: 25, secondary_total: 0 }] } })
  const result = await loadHistoryTotals(client, { ...filters, from: '2026-10-12', to: '2026-10-12' })
  assert.equal(result.primary_total, 25)
  assert.equal(client.calls[1].args.p_business_date, '2026-10-12')
})

test('multi-day fallback applies category, person and inclusive date filters', async () => {
  const row = { source: 'customer', category: 'credit', party_id: 3, entry_type: 'credit_sale', amount: '0.10' }
  const rows = [
    { ...row, id: 1, business_date: '2026-10-01' },
    { ...row, id: 2, business_date: '2026-10-12', amount: '0.20' },
    { ...row, id: 3, business_date: '2026-10-12', entry_type: 'credit_recovery', amount: '0.10' },
    { ...row, id: 4, business_date: '2026-10-13', amount: 999 },
    { ...row, id: 5, business_date: '2026-10-02', party_id: 4, amount: 999 },
    { ...row, id: 6, business_date: '2026-10-02', category: 'supplier', amount: 999 },
  ]
  const client = clientFor({ rpc: () => ({ error: missing }), rows, cap: 2 })
  assert.deepEqual(await loadHistoryTotals(client, { ...filters, partyId: 3, from: '2026-10-01', to: '2026-10-12' }), { entry_count: 3, primary_total: 0.3, secondary_total: 0.1 })
  assert.equal(client.calls.length, 1, 'multi-day filters cannot use the old exact-date RPC')
  assert.deepEqual(client.offsets, [0, 2, 3])
})

test('a completely missing RPC reads every matching row beyond API response limits', async () => {
  const rows = Array.from({ length: 1005 }, (_, id) => ({ source: 'supplier', id, category: 'supplier', entry_type: id % 2 ? 'payment' : 'purchase', amount: '1.00' }))
  const client = clientFor({ rpc: () => ({ error: missing }), rows, cap: 200 })
  assert.deepEqual(await loadHistoryTotals(client, { ...filters, category: 'supplier' }), { entry_count: 1005, primary_total: 503, secondary_total: 502 })
  assert.deepEqual(client.offsets, [0, 200, 400, 600, 800, 1000, 1005])
})

test('empty history returns zero totals', async () => {
  const client = clientFor({ rpc: () => ({ error: missing }) })
  assert.deepEqual(await loadHistoryTotals(client, filters), { entry_count: 0, primary_total: 0, secondary_total: 0 })
})

test('permission and network errors are reported instead of concealed as zero totals', async (t) => {
  t.mock.method(console, 'error', () => {})
  for (const code of ['42501', 'PGRST301', 'FETCH_ERROR']) {
    const client = clientFor({ rpc: () => ({ error: { code, message: 'Request failed' } }) })
    await assert.rejects(loadHistoryTotals(client, filters), (error) => error.cause.code === code)
    assert.equal(client.calls.length, 1)
    assert.deepEqual(client.offsets, [])
  }
  const client = clientFor({ rpc: () => ({ error: missing }), viewError: { code: '42501', message: 'View access denied' } })
  await assert.rejects(loadHistoryTotals(client, filters), (error) => error.cause.code === '42501')
})
