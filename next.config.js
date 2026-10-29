import { postgresToolsFolder } from './src/lib/postgres-tools.js'

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  distDir: process.env.CASH_TOOL_PAGE_CHECK === '1' ? '.next-page-check' : '.next',
  outputFileTracingIncludes: {
    '/admin/backups/download': [
      `${postgresToolsFolder}/bin/pg_dump*`, `${postgresToolsFolder}/bin/*.dll`, `${postgresToolsFolder}/lib/**/*`,
      `${postgresToolsFolder}/LICENSE*`, `${postgresToolsFolder}/*license*.txt`,
    ],
  },
}

export default nextConfig
