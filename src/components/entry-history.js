import Link from 'next/link'
import { getEntryHistory } from '@/lib/history-data'
import { historyCategories, historyUrl } from '@/lib/history'
import { businessDate, dateTime, formatDate, taka } from '@/lib/format'

export async function EntryHistory({ category, searchParams }) {
  const config = historyCategories[category]
  const data = await getEntryHistory(category, await searchParams)
  const primary = Number(data.totals.primary_total)
  const secondary = Number(data.totals.secondary_total)
  const columns = ['Date & Time', ...(config.party ? [config.party] : []), ...(config.name ? [config.name] : []), ...(config.primary ? [config.primary, config.secondary] : [config.amount])]
  return <div className="page-stack history-page">
    <header className="page-heading"><div><p className="eyebrow">History</p><h1>{config.title}</h1><p>All recorded entries. Dates and times are shown in Bangladesh time.</p></div><Link className="button secondary" href="/dashboard">Today's Dashboard</Link></header>
    {config.party && <form method="get" action={config.path} className="card filter-bar history-filter"><label><span>{config.party}</span><select name="party" defaultValue={data.partyId || ''}><option value="">All {config.table === 'customers' ? 'people' : 'companies'}</option>{data.parties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}</select></label><div className="filter-actions"><button type="submit" className="button primary">Apply</button><Link className="button ghost" href={config.path}>Reset</Link></div></form>}
    <div className="history-totals card" aria-label="Totals for all matching entries">
      <div><span>Entries</span><strong>{data.totals.entry_count}</strong></div>
      <div><span>{config.primary ? `Total ${config.primary}` : 'Total Amount'}</span><strong>{taka(primary)}</strong></div>
      {config.secondary && <><div><span>Total {config.secondary}</span><strong>{taka(secondary)}</strong></div><div><span>{config.primary} less {config.secondary.toLowerCase()}</span><strong>{taka(primary - secondary)}</strong></div></>}
    </div>
    <div className="data-table-wrap"><table className="data-table"><thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>
      {data.entries.map((entry) => <tr key={`${entry.source}-${entry.id}`}>
        <td data-label="Date & Time"><time dateTime={entry.created_at}>{dateTime(entry.created_at)}</time>{entry.business_date !== businessDate(new Date(entry.created_at)) && <small className="history-note">Report: {formatDate(entry.business_date)}</small>}</td>
        {config.party && <td data-label={config.party}>{entry.party_name}</td>}
        {config.name && <td data-label={config.name}>{entry.party_name}</td>}
        {config.primary ? <><td data-label={config.primary}>{entry.entry_type === config.primaryType ? taka(entry.amount) : '—'}</td><td data-label={config.secondary}>{entry.entry_type !== config.primaryType ? taka(entry.amount) : '—'}</td></> : <td data-label={config.amount}>{taka(entry.amount)}{entry.entry_type === 'previous_total' && <small className="history-note">Previous daily total</small>}{entry.entry_type === 'adjustment' && <small className="history-note">Adjustment</small>}</td>}
      </tr>)}
    </tbody></table>{!data.entries.length && <div className="empty-state"><p>No entries match this selection.</p></div>}</div>
    {data.pages > 1 && <nav className="pagination" aria-label="History pages">{data.page > 1 && <Link className="button secondary" href={historyUrl(config.path, data.page - 1, data.partyId)}>Previous</Link>}<span>Page {data.page} of {data.pages}</span>{data.page < data.pages && <Link className="button secondary" href={historyUrl(config.path, data.page + 1, data.partyId)}>Next</Link>}</nav>}
  </div>
}
