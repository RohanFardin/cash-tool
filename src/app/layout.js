import './globals.css'

export const metadata = {
  title: { default: 'Pharmacy Accounts', template: '%s · Pharmacy Accounts' },
  description: 'Daily pharmacy financial reporting and administration.',
}

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b6b57' }

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>
}
