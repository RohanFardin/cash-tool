export const BUSINESS_TIME_ZONE = 'Asia/Dhaka'

export function displayUserName(value) {
  return String(value || 'User').replace(/\bstorekeeper(s?)\b/gi, (_match, plural) => plural ? 'Users' : 'User')
}

export function businessDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function formatDate(value, long = false) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

export function taka(value) {
  return `৳${new Intl.NumberFormat('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))}`
}

export function dateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-BD', {
    dateStyle: 'medium', timeStyle: 'medium', timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(value))
}
