import Link from 'next/link'
export default function NotFound() { return <main className="error-screen"><h1>Page not found</h1><p>The requested page or report does not exist.</p><Link className="button primary" href="/">Return home</Link></main> }
