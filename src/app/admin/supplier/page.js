import { EntryHistory } from '@/components/entry-history'
export const metadata = { title: 'Supplier' }
export const dynamic = 'force-dynamic'
export default function Page({ searchParams }) { return <EntryHistory category="supplier" searchParams={searchParams} admin /> }
