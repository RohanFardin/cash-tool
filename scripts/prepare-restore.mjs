import { join } from 'node:path'
import { prepareSupabaseRestoreSql } from '../src/lib/backup-restore.js'

const archive = process.argv[2]
if (!archive) throw new Error('Usage: npm run backup:restore-sql -- path/to/backup.dump [output.sql]')
const output = process.argv[3] || join('.database-backups', `restore-${Date.now()}.sql`)
console.log(`Restore script prepared: ${await prepareSupabaseRestoreSql(archive, output)}`)
console.log('This has not changed a database. Follow docs/database-backups.md to restore into a new Supabase project.')
