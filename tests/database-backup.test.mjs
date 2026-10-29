import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile, stat } from 'node:fs/promises'
import { BackupError, backupConnection, backupFilename, backupStream, createDatabaseBackup } from '../src/lib/database-backup.js'
import { prepareSupabaseRestoreSql } from '../src/lib/backup-restore.js'
import { join } from 'node:path'
import { backupAdminId, backupUserId, createApplicationFixture, nativePostgresAvailable, startPostgresFixture } from './helpers/postgres-fixture.mjs'

test('backup configuration requires a private PostgreSQL connection to the correct Supabase project', () => {
  const url = 'postgresql://postgres.projectref:pass%40word@aws-0-example.pooler.supabase.com:5432/postgres'
  const env = backupConnection(url, 'https://projectref.supabase.co')
  assert.equal(env.PGPASSWORD, 'pass@word')
  assert.equal(env.PGUSER, 'postgres.projectref')
  assert.equal(env.PGSSLMODE, 'require')
  assert.ok(env.PGOPTIONS.includes('default_transaction_read_only=on'))
  assert.equal(backupConnection(url.replace('postgres.projectref', 'backup_reader.projectref'), 'https://projectref.supabase.co').PGUSER, 'backup_reader.projectref')
  for (const bad of [undefined, 'not-a-connection', 'https://example.com', url.replace('5432', '6543'), url.replace('projectref:', 'otherproject:'), url + '?sslmode=disable']) {
    assert.throws(() => backupConnection(bad, 'https://projectref.supabase.co'), BackupError)
  }
  assert.equal(backupConnection('postgresql://postgres@127.0.0.1:5432/test').PGSSLMODE, 'disable')
  assert.equal(backupFilename(new Date('2026-10-29T12:34:56.000Z')), 'joarder-pharmacy-backup-2026-10-29T12-34-56-000Z.dump')
})

let fixture, backup
before(async () => {
  if (!nativePostgresAvailable) return
  fixture = await startPostgresFixture()
  await createApplicationFixture(fixture)
  backup = await createDatabaseBackup({ databaseUrl: fixture.databaseUrl('source', 'backup_reader') })
})
after(async () => { await backup?.cleanup(); await fixture?.close() })
const integration = { skip: !nativePostgresAvailable && 'Run npm run backup:prepare to enable native dump/restore checks.' }

test('a native backup restores all tables, old reports, drafts, contacts, password hashes and sequences', integration, async () => {
  const bytes = await readFile(backup.file)
  assert.equal(bytes.subarray(0, 5).toString(), 'PGDMP')
  await fixture.createDatabase('restored')
  await fixture.invoke('pg_restore', ['--exit-on-error', '--no-owner', '--dbname', fixture.databaseUrl('restored'), backup.file])
  const tables = await fixture.rows('source', "select schemaname,tablename from pg_tables where schemaname in ('public','auth') order by schemaname,tablename")
  for (const table of tables) {
    const query = `select * from ${table.schemaname}.${table.tablename} order by 1`
    assert.deepEqual(await fixture.rows('restored', query), await fixture.rows('source', query), `${table.schemaname}.${table.tablename} is restored exactly`)
  }
  assert.equal((await fixture.rows('restored', "select count(*)::int as count from public.future_records"))[0].count, 1205)
  assert.equal((await fixture.rows('restored', "select count(*)::int as count from public.daily_reports where status='draft'"))[0].count, 1)
  assert.equal((await fixture.rows('restored', `select encrypted_password=crypt('FixtureUserPassword12!',encrypted_password) as valid from auth.users where id='${backupUserId}'`))[0].valid, true)
  assert.equal(await fixture.execute('restored', "insert into public.future_records(details) values('after restore') returning id"), '1206\nINSERT 0 1')
  assert.deepEqual(await fixture.rows('restored', 'select * from public.daily_cash_balances'), await fixture.rows('source', 'select * from public.daily_cash_balances'))
})

test('restored RLS, immutable-entry guards and administrator settings remain effective', integration, async () => {
  await fixture.execute('restored', `set role authenticated; select set_config('request.jwt.claim.sub','${backupUserId}',false); update public.cash_sales_entries set amount=999 where id=1`)
  assert.equal((await fixture.rows('restored', 'select amount from public.cash_sales_entries where id=1'))[0].amount, 1000, 'RLS prevents operator updates')
  assert.equal(await fixture.execute('restored', 'set role anon; select count(*) from public.profiles').catch(() => 'denied'), 'denied')
  assert.equal((await fixture.rows('restored', `select entry_editing_enabled from public.profiles where id='${backupAdminId}'`))[0].entry_editing_enabled, false)
  await assert.rejects(fixture.execute('restored', `select set_config('request.jwt.claim.sub','${backupAdminId}',false); update public.cash_sales_entries set amount=999 where id=1`), /Enable entry editing/)
  await fixture.execute('restored', "insert into auth.users(id,email) values ('44444444-4444-4444-8444-444444444444','newuser@pharmacy.local')")
  assert.equal((await fixture.rows('restored', "select username from public.profiles where id='44444444-4444-4444-8444-444444444444'"))[0].username, 'newuser')
})

test('the Supabase restore script preserves managed Auth setup while restoring app data and logins', integration, async () => {
  await fixture.createDatabase('supabase_target')
  await fixture.execute('supabase_target', `
    create extension pgcrypto;
    create schema auth;
    create table auth.users (id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb,encrypted_password text);
    create table auth.identities (id uuid primary key,user_id uuid references auth.users,identity_data jsonb,provider text);
    create table auth.schema_migrations (version text primary key);
    insert into auth.schema_migrations values ('target-managed-version');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `)
  const sql = await prepareSupabaseRestoreSql(backup.file, join(fixture.directory, 'restore.sql'))
  await fixture.invoke('psql', ['-X', '--set=ON_ERROR_STOP=1', '--dbname', fixture.databaseUrl('supabase_target'), '--file', sql])
  assert.equal((await fixture.rows('supabase_target', 'select version from auth.schema_migrations'))[0].version, 'target-managed-version')
  assert.deepEqual(await fixture.rows('supabase_target', 'select * from public.daily_reports order by id'), await fixture.rows('source', 'select * from public.daily_reports order by id'))
  assert.equal((await fixture.rows('supabase_target', `select encrypted_password=crypt('FixtureUserPassword12!',encrypted_password) as valid from auth.users where id='${backupUserId}'`))[0].valid, true)
  await fixture.execute('supabase_target', "insert into auth.users(id,email) values('55555555-5555-4555-8555-555555555555','restoreduser@pharmacy.local')")
  assert.equal((await fixture.rows('supabase_target', "select username from public.profiles where id='55555555-5555-4555-8555-555555555555'"))[0].username, 'restoreduser')
})

test('streamed downloads remove temporary backup files after completion', integration, async () => {
  const downloadable = await createDatabaseBackup({ databaseUrl: fixture.databaseUrl('source') })
  const body = Buffer.from(await new Response(backupStream(downloadable)).arrayBuffer())
  assert.equal(body.subarray(0, 5).toString(), 'PGDMP')
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await stat(downloadable.file); await new Promise(done => setTimeout(done, 25)) }
    catch { return }
  }
  assert.fail('Temporary backup was not removed.')
})

test('failed connections and aborted backups return safe errors without leaking credentials', integration, async () => {
  await assert.rejects(createDatabaseBackup({ databaseUrl: fixture.databaseUrl('missing_database') }), error => error instanceof BackupError && !error.message.includes(fixture.databaseUrl('missing_database')))
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(createDatabaseBackup({ databaseUrl: fixture.databaseUrl('source'), signal: aborted.signal }), /cancelled/)
})
