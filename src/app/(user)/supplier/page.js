import { EntryHistory } from '@/components/entry-history'

export const metadata = { title: 'Supplier History' }
export const dynamic = 'force-dynamic'

export default function Page({ searchParams }) {
  return <EntryHistory category="supplier" searchParams={searchParams} />
}
