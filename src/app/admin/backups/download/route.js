import { getViewer } from '@/lib/auth'
import { BackupError, backupStream, createDatabaseBackup } from '@/lib/database-backup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' }
function failure(error, status) { return Response.json({ error }, { status, headers: privateHeaders }) }

export async function POST(request) {
  const viewer = await getViewer()
  if (!viewer) return failure('Please sign in again to download a backup.', 401)
  if (viewer.profile.role !== 'superadmin') return failure('Only an administrator can download database backups.', 403)
  if (request.headers.get('origin') !== new URL(request.url).origin) return failure('Start the backup from this app’s Settings page.', 403)
  try {
    const backup = await createDatabaseBackup({
      databaseUrl: process.env.SUPABASE_DB_URL, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, signal: request.signal,
    })
    return new Response(backupStream(backup, request.signal), { headers: {
      ...privateHeaders, 'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${backup.filename}"`,
      'Content-Length': String(backup.size),
    } })
  } catch (error) {
    return failure(error instanceof BackupError ? error.message : 'Unable to create the database backup. Please try again.', error instanceof BackupError ? error.status : 500)
  }
}
