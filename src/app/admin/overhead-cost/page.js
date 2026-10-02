import { EntryHistory } from '@/components/entry-history'
export const metadata = { title: 'Overhead Cost' }
export const dynamic = 'force-dynamic'
export default function Page({ searchParams }) { return <EntryHistory category="overhead" searchParams={searchParams} admin /> }
