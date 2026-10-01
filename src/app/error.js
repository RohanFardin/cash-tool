'use client'
export default function ErrorPage({ reset }) { return <main className="error-screen"><h1>Something went wrong</h1><p>We couldn’t load this page. Please try again.</p><button className="button primary" onClick={reset}>Try again</button></main> }
