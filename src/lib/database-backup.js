import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdtemp, open, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { postgresTools } from './postgres-tools.js'

export class BackupError extends Error {
  constructor(message, status = 500) { super(message); this.status = status }
}

export function backupConnection(databaseUrl, supabaseUrl) {
  if (!databaseUrl) throw new BackupError('Database backups are not configured for this deployment.', 503)
  try {
    const url = new URL(databaseUrl)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username) throw new Error()
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    const user = decodeURIComponent(url.username), password = decodeURIComponent(url.password)
    const database = decodeURIComponent(url.pathname.slice(1)) || 'postgres'
    if (!/^[\w-]+$/.test(database) || (!local && !password)) throw new Error()
    if (url.hostname.endsWith('.pooler.supabase.com') && url.port === '6543') {
      throw new BackupError('Use the Supabase Session pooler connection on port 5432 for database backups.', 503)
    }
    const project = supabaseUrl && new URL(supabaseUrl).hostname.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1]
    const databaseProject = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1]
      || (url.hostname.endsWith('.pooler.supabase.com') ? user.match(/\.([a-z0-9]+)$/)?.[1] : null)
    if (project && databaseProject !== project) throw new BackupError('The backup connection must use this app’s Supabase project.', 503)
    const ssl = url.searchParams.get('sslmode') || (local ? 'disable' : 'require')
    if (!['require', 'verify-ca', 'verify-full'].includes(ssl) && !(local && ssl === 'disable')) throw new Error()
    return {
      PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432',
      PGUSER: user, PGPASSWORD: password, PGDATABASE: database, PGSSLMODE: ssl,
      PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'joarder-pharmacy-backup',
      PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=210000',
    }
  } catch (error) {
    if (error instanceof BackupError) throw error
    throw new BackupError('The server’s backup database connection is invalid.', 503)
  }
}

export function backupFilename(now = new Date()) {
  return `joarder-pharmacy-backup-${now.toISOString().replace(/[:.]/g, '-')}.dump`
}

export function backupProcessError(stderr, { directConnection = false } = {}) {
  if (/server version mismatch|server version:.*pg_dump version:/s.test(stderr)) {
    return new BackupError('The backup client needs updating for this database version.', 503)
  }
  if (/could not translate host name|Name or service not known|nodename nor servname|getaddrinfo|Network is unreachable|No route to host/i.test(stderr)) {
    return new BackupError(directConnection
      ? 'The direct database host could not be reached. Set SUPABASE_DB_URL to the Session pooler connection from Supabase Connect, using port 5432.'
      : 'The backup database host could not be reached. Check the Session pooler hostname and port in SUPABASE_DB_URL.', 503)
  }
  if (/password authentication failed|SASL authentication failed/i.test(stderr)) {
    return new BackupError('Database authentication failed. Check the database username and password in SUPABASE_DB_URL.', 503)
  }
  if (/tenant or user not found/i.test(stderr)) {
    return new BackupError('The pooler could not find that database user. Check the username and Session pooler host from Supabase Connect.', 503)
  }
  if (/permission denied|query would be affected by row-level security policy/i.test(stderr)) {
    return new BackupError('The backup database user cannot read every table. Check the backup reader permissions, including pg_read_all_data and BYPASSRLS.', 503)
  }
  // PostgreSQL messages can contain credentials. Return only fixed messages.
  return new BackupError('Unable to back up the database. Check the server’s database connection and permissions.')
}

export async function createDatabaseBackup({ databaseUrl, supabaseUrl, signal, timeout = 240_000 } = {}) {
  const connection = backupConnection(databaseUrl, supabaseUrl)
  const tools = postgresTools()
  const temporary = await mkdtemp(join(tmpdir(), 'joarder-backup-'))
  const file = join(temporary, 'database.dump')
  const cleanup = async () => {
    if (dirname(temporary) !== resolve(tmpdir()) || !basename(temporary).startsWith('joarder-backup-')) throw new Error('Invalid backup temporary directory.')
    await rm(temporary, { recursive: true, force: true })
  }
  try {
    await new Promise((done, reject) => {
      let stderr = ''
      let startError = null
      const child = spawn(tools.executable('pg_dump'), [
        '--format=custom', '--compress=6', '--encoding=UTF8', '--no-password', '--lock-wait-timeout=15000', `--file=${file}`,
      ], { env: { ...tools.environment, ...connection }, windowsHide: true, signal, timeout, killSignal: 'SIGKILL', stdio: ['ignore', 'ignore', 'pipe'] })
      child.stderr.on('data', (chunk) => { if (stderr.length < 8192) stderr += chunk.toString().slice(0, 8192 - stderr.length) })
      child.on('error', (error) => { startError = error })
      child.on('close', (code, killed) => {
        if (signal?.aborted) return reject(new BackupError('The backup was cancelled.', 499))
        if (startError) return reject(new BackupError(startError.code === 'ENOENT' ? 'Backup tools are missing. Redeploy with the standard build command.' : 'Unable to start the database backup.', startError.code === 'ENOENT' ? 503 : 500))
        if (code === 0) return done()
        if (killed) return reject(new BackupError('The backup timed out. Please try again or contact your administrator.', 504))
        reject(backupProcessError(stderr, { directConnection: connection.PGHOST.startsWith('db.') }))
      })
    })
    const handle = await open(file, 'r')
    const header = Buffer.alloc(5)
    try { await handle.read(header, 0, 5, 0) } finally { await handle.close() }
    if (header.toString() !== 'PGDMP') throw new BackupError('The database backup did not complete correctly.')
    const { size } = await stat(file)
    return { file, size, filename: backupFilename(), cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

export function backupStream(backup, signal) {
  const stream = createReadStream(backup.file)
  const cancel = () => stream.destroy()
  signal?.addEventListener('abort', cancel, { once: true })
  stream.once('close', () => {
    signal?.removeEventListener('abort', cancel)
    backup.cleanup().catch(() => {})
  })
  if (signal?.aborted) stream.destroy()
  return Readable.toWeb(stream)
}
