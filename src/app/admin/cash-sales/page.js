import { EntryHistory } from '@/components/entry-history'
export const metadata = { title: 'Cash Sales' }
export const dynamic = 'force-dynamic'
export default function Page({ searchParams }) { return <EntryHistory category="cash_sales" searchParams={searchParams} admin /> }
