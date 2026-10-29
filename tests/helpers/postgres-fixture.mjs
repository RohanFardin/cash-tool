import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { postgresTools } from '../../src/lib/postgres-tools.js'

const run = promisify(execFile)
const tools = postgresTools()
export const nativePostgresAvailable = existsSync(tools.executable('initdb'))
export const backupAdminId = '22222222-2222-4222-8222-222222222222'
export const backupUserId = '11111111-1111-4111-8111-111111111111'

export async function startPostgresFixture() {
  const parent = resolve('.next-page-check')
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(join(parent, 'postgres-'))
  const data = join(directory, 'data')
  const invoke = (name, args, environment = {}) => run(tools.executable(name), args, {
    env: { ...tools.environment, ...environment }, windowsHide: true, timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
  })
  let running = false
  async function close() {
    if (running) { await invoke('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']); running = false }
    if (dirname(directory) !== parent) throw new Error('Invalid fixture directory.')
    await rm(directory, { recursive: true, force: true })
  }
  try {
    await invoke('initdb', ['-D', data, '--username=postgres', '--auth=trust', '--no-locale', '--encoding=UTF8', '--no-sync'])
    const listener = createServer()
    await new Promise(done => listener.listen(0, '127.0.0.1', done))
    const port = listener.address().port
    await new Promise(done => listener.close(done))
    await invoke('pg_ctl', ['-D', data, '-l', join(directory, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -c fsync=off`, '-w', 'start'])
    running = true
    const environment = { PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'postgres', PGSSLMODE: 'disable' }
    const execute = async (database, sql) => (await invoke('psql', ['-X', '--no-password', '--set=ON_ERROR_STOP=1', '-At', '--dbname', database, '--command', sql], environment)).stdout.replaceAll('\r\n', '\n').trim()
    const rows = async (database, sql) => JSON.parse(await execute(database, `select coalesce(json_agg(row_to_json(q)), '[]'::json) from (${sql}) q`))
    const createDatabase = async (name) => {
      if (!/^[a-z_]+$/.test(name)) throw new Error('Invalid fixture database name.')
      await execute('postgres', `create database ${name}`)
    }
    await execute('postgres', 'create role authenticated nologin; create role anon nologin;')
    await execute('postgres', 'create role backup_reader login bypassrls; grant pg_read_all_data to backup_reader; alter role backup_reader set default_transaction_read_only=on;')
    const databaseUrl = (name, user = 'postgres') => `postgresql://${user}@127.0.0.1:${port}/${name}?sslmode=disable`
    return { directory, invoke, environment, execute, rows, createDatabase, databaseUrl, close }
  } catch (error) { await close(); throw error }
}

export async function createApplicationFixture(fixture, name = 'source') {
  await fixture.createDatabase(name)
  await fixture.execute(name, `
    create extension pgcrypto;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, encrypted_password text);
    create table auth.identities (id uuid primary key, user_id uuid references auth.users, identity_data jsonb, provider text);
    create table auth.schema_migrations (version text primary key);
    insert into auth.schema_migrations values ('fixture-managed-version');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `)
  const migrations = new URL('../../supabase/migrations/', import.meta.url)
  for (const file of (await readdir(migrations)).filter(file => file.endsWith('.sql')).sort()) {
    await fixture.execute(name, await readFile(new URL(file, migrations), 'utf8'))
  }
  await fixture.execute(name, `
    insert into auth.users (id,email,encrypted_password) values
      ('${backupUserId}','user@pharmacy.local',crypt('FixtureUserPassword12!',gen_salt('bf'))),
      ('${backupAdminId}','admin@pharmacy.local',crypt('FixtureAdminPassword12!',gen_salt('bf')));
    insert into auth.identities values ('33333333-3333-4333-8333-333333333333','${backupUserId}','{"email":"user@pharmacy.local"}','email');
    update public.profiles set role='superadmin',full_name='Backup Administrator' where id='${backupAdminId}';
    select set_config('request.jwt.claim.sub','${backupAdminId}',false);
    insert into public.customers (name,created_by,phone_number,notes) values ('Alice','${backupAdminId}','01700000000','Contact snapshot');
    insert into public.suppliers (name,created_by) values ('Medicine Company','${backupAdminId}');
    insert into public.overhead_categories (name,created_by) values ('Rent','${backupAdminId}') on conflict do nothing;
    select public.admin_save_staged_report(public.current_business_date()-10, '[
      {"kind":"cash","amount":1000},
      {"kind":"customer","party_id":1,"entry_type":"credit_sale","amount":50},
      {"kind":"customer","party_id":1,"entry_type":"credit_recovery","amount":20},
      {"kind":"supplier","party_id":1,"entry_type":"purchase","amount":60},
      {"kind":"supplier","party_id":1,"entry_type":"payment","amount":30},
      {"kind":"transaction","category":"cash_purchase","amount":10},
      {"kind":"transaction","category":"overhead","overhead_category_id":1,"amount":5},
      {"kind":"transaction","category":"conveyance","amount":2}
    ]');
    insert into public.daily_reports(business_date,submitted_by) values(public.current_business_date(),'${backupUserId}');
    insert into public.cash_sales_entries(daily_report_id,amount,created_by) values(2,7,'${backupUserId}');
    create table public.future_records (id bigint generated always as identity primary key, details text);
    insert into public.future_records(details) select 'Record '||generate_series(1,1205);
  `)
}
