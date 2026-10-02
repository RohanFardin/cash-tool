import test from 'node:test'
import assert from 'node:assert/strict'
import { historyFilters, historyUrl, validHistoryDate } from '../src/lib/history.js'
import { businessDate } from '../src/lib/format.js'

test('Bangladesh midnight changes the dashboard business day', () => {
  assert.equal(businessDate(new Date('2026-10-02T17:59:59Z')), '2026-10-02')
  assert.equal(businessDate(new Date('2026-10-02T18:00:00Z')), '2026-10-03')
})

test('history filters reject unsafe and malformed identifiers and page numbers', () => {
  for (const value of ['-1', '0', '1.5', 'hello', '1e3', '999999999999999999999', ['1']]) {
    assert.deepEqual(historyFilters({ party: value, page: value }), { partyId: null, page: 1 })
  }
  assert.deepEqual(historyFilters({ party: '3', page: '2' }), { partyId: 3, page: 2 })
})

test('paging preserves the selected person or company', () => {
  assert.equal(historyUrl('/credit-recovery', 2, 3), '/credit-recovery?party=3&page=2')
  assert.equal(historyUrl('/supplier', 1, 3), '/supplier?party=3')
  assert.equal(historyUrl('/cash-sales', 1, null), '/cash-sales')
})

test('admin history dates are real dates and survive paging', () => {
  assert.equal(validHistoryDate('2026-02-30'), null)
  assert.equal(validHistoryDate('2026-10-02'), '2026-10-02')
  assert.equal(validHistoryDate(['2026-10-02']), null)
  assert.equal(historyUrl('/admin/credit-recovery', 2, 3, '2026-10-02'), '/admin/credit-recovery?party=3&date=2026-10-02&page=2')
})
