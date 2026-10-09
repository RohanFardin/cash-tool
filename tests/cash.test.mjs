import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateCashInHand, cumulativeCashReports } from '../src/lib/cash.js'
import { displayUserName } from '../src/lib/format.js'

test('closing cash includes carried balance, cash receipts and paid expenses', () => {
  assert.equal(calculateCashInHand({
    cash_sales: 1000, credit_recovery: 200, supplier_payments: 100,
    cash_purchases: 80, overhead_cost: 50, conveyance: 30,
    credit_sales: 900, supplier_purchases: 500,
  }, 400), 1340)
})

test('closing cash supports zero, deficits and decimal amounts', () => {
  assert.equal(calculateCashInHand({}, 400), 400)
  assert.equal(calculateCashInHand({ overhead_cost: 500 }, 400), -100)
  assert.equal(calculateCashInHand({ overhead_cost: 400 }, 400), 0)
  assert.equal(calculateCashInHand({ cash_sales: 0.1, credit_recovery: 0.2 }, 0.3), 0.6)
})

test('existing daily reports produce chronological balances without drafts or rounding drift', () => {
  const reports = [
    { id: 3, status: 'approved', business_date: '2026-10-05', cash_sales: '2.00', cash_in_hand: '-0.10' },
    { id: 1, status: 'submitted', business_date: '2026-10-01', cash_sales: '1.00', cash_in_hand: '0.10' },
    { id: 4, status: 'draft', business_date: '2026-10-06', cash_sales: 100, cash_in_hand: null },
    { id: 2, status: 'submitted', business_date: '2026-10-03', cash_sales: '1.50', cash_in_hand: '0.20' },
  ]
  const balances = cumulativeCashReports(reports)
  assert.deepEqual(balances.map((report) => [report.id, report.total_sales, report.cash_in_hand]), [[1, 1, 0.1], [2, 1.5, 0.3], [3, 2, 0.2]])
  assert.equal(reports[0].cash_in_hand, '-0.10')
  assert.deepEqual(cumulativeCashReports([]), [])
})

test('legacy display names use User while preserving personal names', () => {
  assert.equal(displayUserName('Storekeeper'), 'User')
  assert.equal(displayUserName('Second Storekeeper'), 'Second User')
  assert.equal(displayUserName('Administrator'), 'Administrator')
  assert.equal(displayUserName('Afzal'), 'Afzal')
})
