import { taka } from '@/lib/format'

export const summaryItems = [
  ['cash_sales', 'Cash Sales', 'emerald'], ['credit_sales', 'Credit Sales', 'blue'],
  ['credit_recovery', 'Credit Recovery', 'cyan'], ['supplier_payments', 'Supplier Payment', 'amber'],
  ['supplier_purchases', 'Supplier Purchase', 'rose'],
  ['cash_purchases', 'Cash Purchase', 'violet'], ['overhead_cost', 'Overhead Cost', 'rose'],
  ['conveyance', 'Conveyance', 'slate'],
]

export function StatCards({ values, compact = false }) {
  return <div className={`stat-grid ${compact ? 'compact' : ''}`}>{summaryItems.map(([key, label, tone]) => <article className={`stat-card ${tone}`} key={key}><span>{label}</span><strong>{taka(values?.[key])}</strong></article>)}</div>
}
