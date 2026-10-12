import Link from 'next/link'
import { historyUrl } from '@/lib/history'

export function HistoryPagination({ path, data, date = null, label = 'History pages' }) {
  if (data.pages <= 1) return null
  const href = (page) => historyUrl(path, page, data.partyId, date, date ? {} : data)
  return <nav className="pagination" aria-label={label}>
    {data.page > 1 && <Link className="button secondary" href={href(data.page - 1)}>Previous</Link>}
    <span>Page {data.page} of {data.pages}</span>
    {data.page < data.pages && <Link className="button secondary" href={href(data.page + 1)}>Next</Link>}
  </nav>
}
