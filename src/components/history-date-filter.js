import Link from 'next/link'

export function HistoryDateFilter({ path, data, partyLabel, parties = [], partyTable }) {
  return <form method="get" action={path} className="card filter-bar history-filter">
    <label><span>Date From</span><input type="date" name="from" defaultValue={data.from || ''} /></label>
    <label><span>Date To</span><input type="date" name="to" defaultValue={data.to || ''} /></label>
    {partyLabel && <label><span>{partyLabel}</span><select name="party" defaultValue={data.partyId || ''}><option value="">All {partyTable === 'customers' ? 'people' : 'companies'}</option>{parties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}</select></label>}
    <div className="filter-actions"><button type="submit" className="button primary">Apply</button><Link className="button ghost" href={path}>Reset</Link></div>
  </form>
}
