import { getViewer } from '@/lib/auth'
import { businessDate } from '@/lib/format'
import { getReportExportData } from '@/lib/report-export-data'
import { createReportWorkbook, reportExportRange } from '@/lib/report-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Please sign in again to download reports.' }, { status: 401 })
  if (viewer.profile.role !== 'superadmin') return Response.json({ error: 'Only an administrator can download reports.' }, { status: 403 })
  let range
  try {
    range = reportExportRange(Object.fromEntries(new URL(request.url).searchParams), businessDate())
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 })
  }
  try {
    const data = await getReportExportData(range)
    const buffer = await createReportWorkbook(data)
    return new Response(new Uint8Array(buffer), { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="ozi-pharma-report-${range.from}-to-${range.to}.xlsx"`,
      'Cache-Control': 'private, no-store',
    } })
  } catch (error) {
    console.error('Report download failed:', error)
    return Response.json({ error: 'Unable to download the report. Please try again.' }, { status: 500 })
  }
}
