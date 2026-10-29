import { execFile } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { postgresTools } from './postgres-tools.js'

const run = promisify(execFile)

// This prepares a script only. It never connects to or changes a database.
// Supabase supplies its auth schema; restore its rows, not its system DDL.
export async function prepareSupabaseRestoreSql(archive, output) {
  if (resolve(archive) === resolve(output)) throw new Error('Choose a different output file.')
  const tools = postgresTools()
  const temporary = await mkdtemp(join(tmpdir(), 'joarder-restore-'))
  let complete = false
  let created = false
  try {
    const { stdout: contents } = await run(tools.executable('pg_restore'), ['--list', resolve(archive)], { env: tools.environment, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
    const list = contents.split(/\r?\n/).filter(line =>
      !/ SCHEMA - public /.test(line) && !/ TABLE DATA auth schema_migrations /.test(line)).join('\n')
    const listFile = join(temporary, 'restore.list')
    await writeFile(listFile, list)
    await mkdir(dirname(resolve(output)), { recursive: true })
    await writeFile(output, '-- Joarder Pharmacy: restore into a NEW, empty Supabase project.\n-- Contains private account data. Run with psql --set ON_ERROR_STOP=1.\nBEGIN;\nSET session_replication_role = replica;\n', { flag: 'wx' })
    created = true
    for (const section of ['pre-data', 'data', 'post-data']) {
      const file = join(temporary, `${section}.sql`)
      const args = ['--no-owner', '--no-tablespaces', `--section=${section}`, '--schema=public', `--use-list=${listFile}`, `--file=${file}`]
      if (section === 'data') args.push('--schema=auth')
      args.push(resolve(archive))
      await run(tools.executable('pg_restore'), args, { env: tools.environment, windowsHide: true, maxBuffer: 1024 * 1024 })
      // Older supported Supabase projects do not have PostgreSQL 17's timeout.
      // pg_restore emits it as a single SET, never as application row data.
      // Restrict the change to the small header, then stream the table data.
      const handle = await open(file, 'r')
      const bytes = Buffer.alloc(8192)
      let count
      try { count = (await handle.read(bytes, 0, bytes.length, 0)).bytesRead } finally { await handle.close() }
      const text = bytes.subarray(0, count).toString('utf8')
      const timeout = text.match(/^SET transaction_timeout = 0;\r?\n/m)
      const removeTimeout = timeout && timeout.index < 2048 && !/\b(?:COPY|CREATE|INSERT)\b/.test(text.slice(0, timeout.index))
      const split = removeTimeout ? Buffer.byteLength(text.slice(0, timeout.index + timeout[0].length)) : 0
      if (removeTimeout) await appendFile(output, text.slice(0, timeout.index))
      const stream = createReadStream(file, { start: split })
      await pipeline(stream, createWriteStream(output, { flags: 'a' }))
    }
    await appendFile(output, `
-- The app's trigger lives on a Supabase-managed auth table.
DO $joarder_restore$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END;
$joarder_restore$;
SET session_replication_role = origin;
COMMIT;
`)
    complete = true
    return resolve(output)
  } finally {
    if (dirname(temporary) !== resolve(tmpdir())) throw new Error('Invalid restore temporary directory.')
    await rm(temporary, { recursive: true, force: true })
    if (created && !complete) await rm(output, { force: true })
  }
}
