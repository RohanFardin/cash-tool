import { EntryHistory } from '@/components/entry-history'
export const metadata = { title: 'Local Supplier' }
export const dynamic = 'force-dynamic'
export default function Page({ searchParams }) { return <EntryHistory category="cash_purchase" searchParams={searchParams} admin /> }
