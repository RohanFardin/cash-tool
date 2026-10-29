import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BackupError, backupProcessError } from '../src/lib/database-backup.js'

test('an unreachable direct database gives Session pooler instructions without exposing connection details', () => {
  for (const failure of ['could not translate host name', 'Network is unreachable', 'No route to host']) {
    const error = backupProcessError(`pg_dump: ${failure}: postgres://user:private-password@db.private.example/postgres`, { directConnection: true })
    assert.ok(error instanceof BackupError)
    assert.equal(error.status, 503)
    assert.match(error.message, /Session pooler/)
    assert.match(error.message, /5432/)
    assert.ok(!error.message.includes('private-password') && !error.message.includes('db.private.example'))
  }
})

test('backup failures distinguish credentials, pooler user, permissions, version and unknown errors safely', () => {
  for (const [detail, guidance] of [
    ['password authentication failed', /username and password/],
    ['SASL authentication failed', /username and password/],
    ['Tenant or user not found', /pooler could not find/i],
    ['permission denied for table users', /permissions/],
    ['query would be affected by row-level security policy', /BYPASSRLS/],
    ['server version mismatch', /client needs updating/],
    ['could not translate host name', /Session pooler hostname/],
    ['unexpected error', /Unable to back up/],
  ]) {
    const error = backupProcessError(`${detail}\nConnection: postgres://user:private-password@private.example/postgres`)
    assert.match(error.message, guidance)
    assert.ok(!error.message.includes('private-password') && !error.message.includes('private.example'))
  }
})
