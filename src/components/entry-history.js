import Link from 'next/link'
import { getEntryHistory } from '@/lib/history-data'
import { historyCategories, historyUrl } from '@/lib/history'
import { taka } from '@/lib/format'
import { EntryTable } from '@/components/entry-table'

export async function EntryHistory({ category, searchParams, admin = false }) {
  const config = historyCategories[category]
  const path = admin ? '/admin' + config.path : config.path
  const data = await getEntryHistory(category, await searchParams, { admin })
  const primary = Number(data.totals.primary_total)
  const secondary = Number(data.totals.secondary_total)
  return <div className="page-stack history-page">
    <header className="page-heading"><div><p className="eyebrow">{admin ? 'Administration' : 'History'}</p><h1>{config.title}</h1><p>Shared records from all storekeepers. Dates and times are shown in Bangladesh time.</p></div><Link className="button secondary" href={admin ? '/admin/summary' : '/dashboard'}>{admin ? 'Daily Summary' : "Today's Dashboard"}</Link></header>
    {(config.party || admin) && <form method="get" action={path} className="card filter-bar history-filter">{admin && <label><span>Report Date</span><input type="date" name="date" defaultValue={data.date || ''} /></label>}{config.party && <label><span>{config.party}</span><select name="party" defaultValue={data.partyId || ''}><option value="">All {config.table === 'customers' ? 'people' : 'companies'}</option>{data.parties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}</select></label>}<div className="filter-actions"><button type="submit" className="button primary">Apply</button><Link className="button ghost" href={path}>Reset</Link></div></form>}
    <div className="history-totals card" aria-label="Totals for all matching entries">
      <div><span>Entries</span><strong>{data.totals.entry_count}</strong></div>
      <div><span>{config.primary ? 'Total ' + config.primary : 'Total Amount'}</span><strong>{taka(primary)}</strong></div>
      {config.secondary && <><div><span>Total {config.secondary}</span><strong>{taka(secondary)}</strong></div><div><span>{config.balance || `${config.primary} less ${config.secondary.toLowerCase()}`}</span><strong>{taka(primary - secondary)}</strong></div></>}
    </div>
    <EntryTable entries={data.entries} category={category} totals={data.totals} admin={admin} options={data.options} />
    {data.pages > 1 && <nav className="pagination" aria-label="History pages">{data.page > 1 && <Link className="button secondary" href={historyUrl(path, data.page - 1, data.partyId, data.date)}>Previous</Link>}<span>Page {data.page} of {data.pages}</span>{data.page < data.pages && <Link className="button secondary" href={historyUrl(path, data.page + 1, data.partyId, data.date)}>Next</Link>}</nav>}
  </div>
}
