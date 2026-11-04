'use client'

import { startTransition, useEffect } from 'react'
import { logoutAction } from '@/app/actions'

// Signs out after an hour without activity. The last activity time is shared
// by every open tab through localStorage, so it also applies to a browser that
// is reopened later. The login form clears it so each sign-in starts fresh.
const IDLE_LIMIT_MS = 60 * 60 * 1000
const CHECK_EVERY_MS = 30 * 1000
const STORAGE_KEY = 'cash-tool:last-activity'
const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']

function storedActivity() {
  try { return Number(localStorage.getItem(STORAGE_KEY)) || 0 } catch { return 0 }
}

function storeActivity(time) {
  try { localStorage.setItem(STORAGE_KEY, String(time)) } catch {}
}

export function clearIdleActivity() {
  try { localStorage.removeItem(STORAGE_KEY) } catch {}
}

export function IdleLogout() {
  useEffect(() => {
    let lastActivity = 0
    let loggingOut = false
    const logout = () => {
      if (loggingOut) return
      loggingOut = true
      clearIdleActivity()
      startTransition(() => logoutAction())
    }
    const check = () => {
      if (Date.now() - Math.max(lastActivity, storedActivity()) >= IDLE_LIMIT_MS) logout()
    }
    const markActive = () => {
      const now = Date.now()
      // Pointer and scroll events are frequent; record at most every few seconds.
      if (now - lastActivity < 5000) return
      lastActivity = now
      storeActivity(now)
    }
    const visible = () => { if (document.visibilityState === 'visible') check() }

    const previous = storedActivity()
    if (previous && Date.now() - previous >= IDLE_LIMIT_MS) {
      logout()
      return
    }
    markActive()
    for (const name of activityEvents) window.addEventListener(name, markActive, { capture: true, passive: true })
    document.addEventListener('visibilitychange', visible)
    const timer = setInterval(check, CHECK_EVERY_MS)
    return () => {
      for (const name of activityEvents) window.removeEventListener(name, markActive, { capture: true })
      document.removeEventListener('visibilitychange', visible)
      clearInterval(timer)
    }
  }, [])
  return null
}
