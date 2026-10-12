import './globals.css'

export const metadata = {
  title: { default: 'Ozi Pharma', template: '%s · Ozi Pharma' },
  description: 'Daily financial reporting and administration for Ozi Pharma.',
}

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b6b57' }

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>
}
