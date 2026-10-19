import { getCashBalance } from '@/lib/cash-data'
import { formatDate, taka } from '@/lib/format'

export async function SummaryCash({ date }) {
  const [previous, closing] = await Promise.all([
    getCashBalance(date, { before: true }), getCashBalance(date),
  ])
  return <section className="summary-cash-balances" aria-label="Cash balances">
    {[
      ['Yesterday’s Cash in Hand', `Balance before ${formatDate(date)}`, previous.cashInHand],
      ['Cash in Hand', 'Closing balance through this report', closing.cashInHand],
    ].map(([label, description, amount]) => <div key={label} className={`previous-cash-card card ${amount > 0 ? 'positive' : amount < 0 ? 'negative' : 'neutral'}`}>
      <div><span>{label}</span><small>{description}</small></div><strong>{taka(amount)}</strong>
    </div>)}
  </section>
}
