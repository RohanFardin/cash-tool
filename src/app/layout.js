import './globals.css'

export const metadata = {
  title: { default: 'Joarder Pharmacy', template: '%s · Joarder Pharmacy' },
  applicationName: 'Joarder Pharmacy',
  description: 'Daily financial reporting and administration for Joarder Pharmacy.',
}

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#0d8045' }

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>
}
