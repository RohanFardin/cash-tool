import Link from 'next/link'
import { CalendarRange, Filter } from 'lucide-react'

export function HistoryDateFilter({ path, data, partyLabel, parties = [], partyTable }) {
  return <form method="get" action={path} className={`card history-filter date-range-filter${partyLabel ? ' has-party' : ''}`}>
    <div className="filter-heading"><CalendarRange size={18} aria-hidden="true" /><span>Report period</span></div>
    <label className="date-filter-field"><span>Date From</span><input type="date" name="from" defaultValue={data.from || ''} /></label>
    <label className="date-filter-field"><span>Date To</span><input type="date" name="to" defaultValue={data.to || ''} /></label>
    {partyLabel && <label className="party-filter"><span>{partyLabel}</span><select name="party" defaultValue={data.partyId || ''}><option value="">All {partyTable === 'customers' ? 'people' : 'companies'}</option>{parties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}</select></label>}
    <div className="filter-actions"><button type="submit" className="button primary"><Filter size={16} aria-hidden="true" />Apply</button><Link className="button ghost" href={path}>Reset</Link></div>
  </form>
}

export function ReportDateFilter({ path, date, today }) {
  return <form method="get" action={path} className="card history-filter report-date-filter">
    <label className="date-filter-field"><span>Report Date</span><input type="date" name="date" defaultValue={date} max={today} required /></label>
    <div className="filter-actions"><button type="submit" className="button primary"><Filter size={16} aria-hidden="true" />Apply</button><Link className="button ghost" href={path}>Today</Link></div>
  </form>
}
