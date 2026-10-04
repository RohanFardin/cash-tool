import { EntryHistory } from '@/components/entry-history'

export const metadata = { title: 'Due Amount / Due Recovery' }
export const dynamic = 'force-dynamic'

export default function Page({ searchParams }) {
  return <EntryHistory category="credit" searchParams={searchParams} />
}
