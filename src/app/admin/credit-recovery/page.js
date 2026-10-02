import { EntryHistory } from '@/components/entry-history'
export const metadata = { title: 'Credit Sales / Recovery' }
export const dynamic = 'force-dynamic'
export default function Page({ searchParams }) { return <EntryHistory category="credit" searchParams={searchParams} admin /> }
