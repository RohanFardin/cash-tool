'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { ActionMessage } from '@/components/action-ui'

export function DownloadBackup({ configured }) {
  const [pending, setPending] = useState(false)
  const [state, setState] = useState(null)
  async function download() {
    if (pending) return
    setPending(true)
    setState(null)
    try {
      const response = await fetch('/admin/backups/download', { method: 'POST', cache: 'no-store' })
      if (response.redirected) throw new Error('Please sign in again to download a backup.')
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to download the backup.')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = response.headers.get('content-disposition')?.match(/filename="([\w.-]+)"/)?.[1] || 'joarder-pharmacy-backup.dump'
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setState({ ok: true, message: 'Your database backup has been downloaded.' })
    } catch (error) {
      setState({ message: error.message || 'Unable to download the backup. Please try again.' })
    } finally { setPending(false) }
  }
  return <section className="card settings-section" id="download-backup" aria-busy={pending}>
    <h2>Download Backup</h2>
    <p className="helper-text">Download a restorable copy of the database, including all saved entries, drafts, account data and database structure. Every date is included.</p>
    <p className="helper-text">Keep this file private; it includes account information.</p>
    {!configured && <p className="notice error">Database backups are not configured for this deployment.</p>}
    <button type="button" className="button secondary" disabled={pending || !configured} onClick={download}><Download size={18} />{pending ? 'Preparing Backup…' : 'Download Backup'}</button>
    <ActionMessage state={state} />
  </section>
}
