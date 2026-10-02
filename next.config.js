/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  distDir: process.env.CASH_TOOL_PAGE_CHECK === '1' ? '.next-page-check' : '.next',
}

export default nextConfig
