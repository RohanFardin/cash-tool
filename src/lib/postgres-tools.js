import { delimiter, join } from 'node:path'

// Reproducible client build; never download executables during a backup request.
export const POSTGRES_VERSION = '17.11.0'
export const postgresToolsFolder = `.postgresql/${POSTGRES_VERSION}/${process.platform}-${process.arch}`

export function postgresTools(root = process.cwd()) {
  const directory = join(root, postgresToolsFolder)
  const executable = (name) => join(directory, 'bin', `${name}${process.platform === 'win32' ? '.exe' : ''}`)
  const environment = {
    ...process.env,
    PATH: [join(directory, 'bin'), join(directory, 'lib'), process.env.PATH].filter(Boolean).join(delimiter),
    LD_LIBRARY_PATH: [join(directory, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(delimiter),
  }
  return { directory, executable, environment }
}
