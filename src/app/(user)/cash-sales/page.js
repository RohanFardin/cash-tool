import { CashSalesHistory } from '@/components/cash-sales-history'

export const metadata = { title: 'Cash Sales History' }
export const dynamic = 'force-dynamic'

export default function Page({ searchParams }) {
  return <CashSalesHistory searchParams={searchParams} />
}
