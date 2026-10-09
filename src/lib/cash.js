export function calculateCashInHand(totals, openingCashInHand = 0) {
  const net = Number(totals.cash_sales || 0) + Number(totals.credit_recovery || 0)
    - Number(totals.supplier_payments || 0) - Number(totals.cash_purchases || 0)
    - Number(totals.overhead_cost || 0) - Number(totals.conveyance || 0)
  return Math.round((Number(openingCashInHand) + net) * 100) / 100
}

export function cumulativeCashReports(reports) {
  let balanceInCents = 0
  return reports.filter((report) => ['submitted', 'approved'].includes(report.status))
    .sort((a, b) => a.business_date.localeCompare(b.business_date))
    .map((report) => {
      balanceInCents += Math.round(Number(report.cash_in_hand || 0) * 100)
      return {
        ...report,
        total_sales: Number(report.cash_sales || 0),
        daily_cash_change: Number(report.cash_in_hand || 0),
        cash_in_hand: balanceInCents / 100,
      }
    })
}
