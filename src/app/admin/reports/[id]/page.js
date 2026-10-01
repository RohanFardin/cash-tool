import { notFound } from 'next/navigation'
import { getReportDetail } from '@/lib/data'
import { formatDate, dateTime } from '@/lib/format'
import { StatCards } from '@/components/stat-cards'
import { TransactionManager, ApproveReport, AdminReportForm } from '@/components/forms'

export const metadata = { title: 'Report Detail' }
export const dynamic = 'force-dynamic'

export default async function ReportDetailPage({ params }) {
  const { id } = await params
  const detail = await getReportDetail(id)
  if (!detail) notFound()
  const { report, transactions, totals } = detail
  const categories = ['credit', 'supplier_payment', 'cash_purchase', 'overhead', 'conveyance']
  return <div className="page-stack"><header className="page-heading"><div><p className="eyebrow">Daily Report</p><h1>{formatDate(report.business_date, true)}</h1><p>Submitted by {report.profiles?.full_name || 'Unknown'} · Created {dateTime(report.created_at)}</p></div><ApproveReport id={report.id} status={report.status} /></header><StatCards values={totals} compact /><AdminReportForm report={report} />{categories.map((category) => { const entries = transactions.filter((row) => row.category === category); return <section className="admin-detail-section" key={category}><div className="section-heading"><h2>{category.replaceAll('_', ' ')}</h2><span>{entries.length} entries</span></div><TransactionManager category={category} entries={entries} admin reportId={report.id} /></section>})}</div>
}
