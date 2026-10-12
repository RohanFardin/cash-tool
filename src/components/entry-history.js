import Link from 'next/link'
import { getEntryHistory } from '@/lib/history-data'
import { historyCategories } from '@/lib/history'
import { businessDate, taka } from '@/lib/format'
import { EntryTable } from '@/components/entry-table'
import { AdminAddRecord } from '@/components/admin-add-record'
import { HistoryDateFilter } from '@/components/history-date-filter'
import { HistoryPagination } from '@/components/history-pagination'

export async function EntryHistory({ category, searchParams, admin = false }) {
  const config = historyCategories[category]
  const path = admin ? '/admin' + config.path : config.path
  const data = await getEntryHistory(category, await searchParams, { admin })
  const primary = Number(data.totals.primary_total)
  const secondary = Number(data.totals.secondary_total)
  return <div className="page-stack history-page">
    <header className="page-heading"><div><p className="eyebrow">{admin ? 'Administration' : 'History'}</p><h1>{config.title}</h1><p>Shared records from all users. Dates and times are shown in Bangladesh time.</p></div>{admin && config.add ? <AdminAddRecord category={category} path={path} date={data.date || businessDate()} /> : <Link className="button secondary" href={admin ? '/admin/summary' : '/dashboard'}>{admin ? 'Daily Summary' : "Today's Dashboard"}</Link>}</header>
    <HistoryDateFilter path={path} data={data} partyLabel={config.party} partyTable={config.table} parties={data.parties} />
    {data.rangeError && <p className="notice error" role="alert">{data.rangeError}</p>}
    <div className="history-totals card" aria-label="Totals for all matching entries">
      <div><span>Entries</span><strong>{data.totals.entry_count}</strong></div>
      <div><span>{config.primary ? 'Total ' + config.primary : 'Total Amount'}</span><strong>{taka(primary)}</strong></div>
      {config.secondary && <><div><span>Total {config.secondary}</span><strong>{taka(secondary)}</strong></div><div><span>{config.balance || `${config.primary} less ${config.secondary.toLowerCase()}`}</span><strong>{taka(primary - secondary)}</strong></div></>}
    </div>
    <EntryTable entries={data.entries} category={category} totals={data.totals} admin={admin} options={data.options} />
    <HistoryPagination path={path} data={data} />
  </div>
}
