import { EntryHistory } from '@/components/entry-history'

export const metadata = { title: 'Conveyance History' }
export const dynamic = 'force-dynamic'

export default function Page({ searchParams }) {
  return <EntryHistory category="conveyance" searchParams={searchParams} />
}
