import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readSheet } from 'read-excel-file/node'
import { createReportWorkbook, reportExportRange, reportExportRows } from '../src/lib/report-export.js'

const data = {
  from: '2024-02-28', to: '2024-03-02', openingCashInHand: 10.1,
  reports: [
    { id: 2, business_date: '2024-03-01', status: 'approved', cash_in_hand: '-11.00' },
    { id: 1, business_date: '2024-02-28', status: 'submitted', cash_in_hand: '0.20' },
    { id: 3, business_date: '2024-02-29', status: 'draft', cash_in_hand: 999 },
  ],
  summaries: [
    { id: 1, cash_sales: '10.20', credit_sales: '30.40', credit_recovery: '2.50', supplier_purchases: '50.00', supplier_payments: '4.00', cash_purchases: '3.00', overhead_cost: '5.00', conveyance: '0.50' },
    { id: 2, cash_sales: 0, conveyance: 11 },
    { id: 3, cash_sales: 999 },
  ],
}

test('report download validates real dates, ordering and future dates', () => {
  assert.deepEqual(reportExportRange({ from: data.from, to: data.to }, '2024-03-02'), { from: data.from, to: data.to })
  for (const params of [
    {}, { from: '2024-02-30', to: data.to }, { from: ['2024-02-28'], to: data.to },
    { from: '2024-03-02', to: '2024-02-28' }, { from: data.from, to: '2024-03-03' },
    { from: '0000-01-01', to: data.to }, { from: '1899-12-31', to: data.to },
  ]) assert.throws(() => reportExportRange(params, '2024-03-02'))
})

test('report rows include every date, ignore drafts and carry exact closing cash across gaps', () => {
  const rows = reportExportRows(data)
  assert.deepEqual(rows.map((row) => row.date.toISOString().slice(0, 10)), ['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02'])
  assert.deepEqual(rows.map((row) => row.cash_in_hand), [10.3, 10.3, -0.7, -0.7])
  assert.deepEqual(rows.map((row) => row.cash_sales), [10.2, null, 0, null])
  assert.deepEqual(rows.map((row) => row.conveyance), [0.5, null, 11, null])
  assert.equal(rows[0].supplier_purchases, 50)
  assert.equal(rows[0].supplier_payments, 4)
  assert.equal(rows[0].credit_sales, 30.4)
  assert.equal(rows[0].credit_recovery, 2.5)
  assert.equal(data.reports[0].cash_in_hand, '-11.00')
})

test('an empty range of submitted reports still has dated rows with carried cash and blank activity', () => {
  const rows = reportExportRows({ ...data, from: data.to, reports: [], summaries: [], openingCashInHand: 0 })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].cash_in_hand, 0)
  assert.equal(rows[0].credit_sales, null)
})

test('missing submitted totals fail instead of producing an incomplete spreadsheet', () => {
  assert.throws(() => reportExportRows({ ...data, summaries: [] }), /all submitted report totals/)
})

test('the exported file opens as Excel with typed dates, numeric amounts and all requested categories', async () => {
  const buffer = await createReportWorkbook(data)
  const rows = await readSheet(buffer, { sheet: 'Ozi Pharma Daily Reports' })
  assert.deepEqual(rows[0], ['Date', 'Cash in Hand', 'Cash Sales', 'Cash Due', 'Cash Recovery', 'Supplier Purchases', 'Supplier Payments', 'Local Supplier', 'Overhead Cost', 'Conveyance'])
  assert.equal(rows.length, 5)
  assert.deepEqual(rows[1], [new Date('2024-02-28T00:00:00Z'), 10.3, 10.2, 30.4, 2.5, 50, 4, 3, 5, 0.5])
  assert.deepEqual(rows[2], [new Date('2024-02-29T00:00:00Z'), 10.3, null, null, null, null, null, null, null, null])
  assert.deepEqual(rows[3], [new Date('2024-03-01T00:00:00Z'), -0.7, 0, 0, 0, 0, 0, 0, 0, 11])
})
