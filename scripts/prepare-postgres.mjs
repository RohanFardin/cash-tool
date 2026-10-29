import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { POSTGRES_VERSION, postgresTools } from '../src/lib/postgres-tools.js'

const run = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
const tools = postgresTools(root)
const targets = {
  'linux-x64': ['x86_64-unknown-linux-gnu', 'b7a1ba6bae6499d8296e3e81b0171eecfd1766ca9aaa0057e41ad3e844e5e2e0'],
  'linux-arm64': ['aarch64-unknown-linux-gnu', 'abffda09209280ec1502b73720dc4d254fb7fff9a072e324926c600a5b16c221'],
  'win32-x64': ['x86_64-pc-windows-msvc', 'a013f0e082826f53985c7bc2a0fe1c2dcc47a9f3797023938cf1ff8c9d6d1792'],
  'darwin-x64': ['x86_64-apple-darwin', 'e43a81b15e1cfe7f9d8fd79c6d4d0366e9001a5f690e322224dca704656602f7'],
  'darwin-arm64': ['aarch64-apple-darwin', 'fd4b62794b160e26973a768a1eef3248aef9d2ff23ebd6d884a4299485e28e57'],
}
const target = targets[`${process.platform}-${process.arch}`]
if (!target) throw new Error('This platform needs a supported PostgreSQL client build.')

try {
  await access(join(tools.directory, 'ready.json'))
  const { stdout } = await run(tools.executable('pg_dump'), ['--version'], { env: tools.environment, windowsHide: true })
  console.log(`Backup tools ready: ${stdout.trim()}`)
} catch {
  const parent = dirname(tools.directory)
  await mkdir(parent, { recursive: true })
  const temporary = await mkdtemp(join(parent, 'install-'))
  try {
    const name = `postgresql-${POSTGRES_VERSION}-${target[0]}`
    const url = `https://github.com/theseus-rs/postgresql-binaries/releases/download/${POSTGRES_VERSION}/${name}.tar.gz`
    console.log(`Preparing PostgreSQL backup tools ${POSTGRES_VERSION} for ${process.platform}-${process.arch}…`)
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`PostgreSQL client download failed (${response.status}).`)
    const archive = Buffer.from(await response.arrayBuffer())
    if (createHash('sha256').update(archive).digest('hex') !== target[1]) throw new Error('PostgreSQL client checksum mismatch.')
    const archivePath = join(temporary, 'client.tar.gz')
    await writeFile(archivePath, archive)
    await run('tar', ['-xzf', archivePath, '-C', temporary], { windowsHide: true })
    const extracted = join(temporary, name)
    // Only this version/platform's generated directory can be replaced.
    if (!resolve(tools.directory).startsWith(resolve(root, '.postgresql') + sep)) throw new Error('Invalid tools directory.')
    await rm(tools.directory, { recursive: true, force: true })
    await rename(extracted, tools.directory)
    const { stdout } = await run(tools.executable('pg_dump'), ['--version'], { env: tools.environment, windowsHide: true })
    await writeFile(join(tools.directory, 'ready.json'), JSON.stringify({ version: POSTGRES_VERSION, target: target[0], sha256: target[1] }))
    console.log(`Backup tools ready: ${stdout.trim()}`)
  } finally {
    if (dirname(temporary) !== parent) throw new Error('Invalid installer temporary directory.')
    await rm(temporary, { recursive: true, force: true })
  }
}
