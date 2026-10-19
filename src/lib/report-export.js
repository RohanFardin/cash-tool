import writeExcelFile from 'write-excel-file/node'
import { validHistoryDate } from './history.js'

export function reportExportRange(params, today) {
  const from = validHistoryDate(params.from), to = validHistoryDate(params.to)
  if (!from || !to) throw new Error('Choose a valid Date From and Date To.')
  if (from > to) throw new Error('Date From must be on or before Date To.')
  if (from < '1900-01-01' || to > today) throw new Error('Choose dates between 1 January 1900 and today.')
  return { from, to }
}

const columns = [
  ['Date', 'date', 16], ['Cash in Hand', 'cash_in_hand', 20],
  ['Cash Sales', 'cash_sales', 20], ['Cash Due', 'credit_sales', 20],
  ['Cash Recovery', 'credit_recovery', 20], ['Supplier Purchases', 'supplier_purchases', 24],
  ['Supplier Payments', 'supplier_payments', 24], ['Local Supplier', 'cash_purchases', 20],
  ['Overhead Cost', 'overhead_cost', 20], ['Conveyance', 'conveyance', 20],
]

export function reportExportRows({ from, to, reports, summaries, openingCashInHand }) {
  const byDate = new Map(reports.filter((report) => ['submitted', 'approved'].includes(report.status))
    .map((report) => [report.business_date, report]))
  const byId = new Map(summaries.map((summary) => [String(summary.id), summary]))
  let cashCents = Math.round(Number(openingCashInHand) * 100)
  const rows = []
  const day = new Date(`${from}T00:00:00Z`)
  for (let date = from; date <= to; day.setUTCDate(day.getUTCDate() + 1), date = day.toISOString().slice(0, 10)) {
    const report = byDate.get(date)
    const summary = report && byId.get(String(report.id))
    if (report && !summary) throw new Error('Unable to load all submitted report totals.')
    // daily_reports.cash_in_hand is the day's movement, not its closing balance.
    if (report) cashCents += Math.round(Number(report.cash_in_hand || 0) * 100)
    const row = { date: new Date(day), cash_in_hand: cashCents / 100 }
    for (const [, key] of columns.slice(2)) row[key] = report ? Number(summary[key] || 0) : null
    rows.push(row)
  }
  return rows
}

export async function createReportWorkbook(data) {
  const rows = reportExportRows(data)
  return writeExcelFile(rows, {
    sheet: 'Ozi Pharma Daily Reports', stickyRowsCount: 1, stickyColumnsCount: 1,
    columns: columns.map(([header, key, width]) => ({
      width,
      header: { value: header, fontWeight: 'bold', backgroundColor: '#0B6B57', textColor: '#FFFFFF', align: 'left' },
      cell: (row) => ({
        value: row[key], type: key === 'date' ? Date : Number, align: 'left',
        format: key === 'date' ? 'dd mmm yyyy' : '#,##0.00;[Red]-#,##0.00',
      }),
    })),
  }).toBuffer()
}
