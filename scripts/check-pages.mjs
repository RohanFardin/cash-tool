import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { businessDate } from '../src/lib/format.js'

// Exercise the actual Next.js pages against a local Supabase API fixture.
// No project credentials or external Supabase requests are used.
const userId = '11111111-1111-4111-8111-111111111111'
const secondUserId = '33333333-3333-4333-8333-333333333333'
const adminId = '22222222-2222-4222-8222-222222222222'
const timestamp = new Date().toISOString()
const today = businessDate()
const profile = { id: userId, full_name: 'Storekeeper', username: 'user', role: 'user' }
const profiles = [profile, { ...profile, id: secondUserId, full_name: 'Second Storekeeper', username: 'user2' }, { ...profile, id: adminId, full_name: 'Administrator', username: 'admin', role: 'superadmin' }]
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'user@pharmacy.local', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: timestamp }
const report = { id: 1, business_date: today, status: 'draft', cash_sales: 100, updated_at: timestamp, submitted_at: timestamp }
const previousDate = '2020-01-01'
const previousReport = { ...report, id: 2, business_date: previousDate, status: 'submitted', cash_sales: 200 }
const base = { daily_report_id: 1, amount: 100, created_by: userId, created_at: timestamp }
const datasets = {
  profiles, daily_reports: [report, previousReport],
  admin_report_summary: [
    { id: 1, business_date: today, cash_sales: 100, credit_sales: 100, credit_recovery: 0, supplier_purchases: 100, supplier_payments: 0, cash_purchases: 100, overhead_cost: 100, conveyance: 100 },
    { id: 2, business_date: previousDate, cash_sales: 200, credit_sales: 0, credit_recovery: 0, supplier_purchases: 0, supplier_payments: 0, cash_purchases: 0, overhead_cost: 0, conveyance: 0 },
  ],
  customers: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
  suppliers: [{ id: 1, name: 'Medicine Company' }, { id: 2, name: 'Other Company' }],
  overhead_categories: [{ id: 1, name: 'Rent' }],
  customer_balances: [{ id: 1, name: 'Alice', active: true, current_due: 100 }],
  supplier_balances: [{ id: 1, name: 'Medicine Company', active: true, current_due: 100 }],
  cash_sales_entries: [{ ...base, id: 1, entry_type: 'cash_sale' }],
  customer_ledger_entries: [{ ...base, id: 1, customer_id: 1, entry_type: 'credit_sale', customers: { name: 'Alice' } }],
  supplier_ledger_entries: [{ ...base, id: 1, supplier_id: 1, entry_type: 'purchase', suppliers: { name: 'Medicine Company' } }],
  transactions: ['cash_purchase', 'overhead', 'conveyance'].map((category, index) => ({ ...base, id: index + 1, category, name: category === 'overhead' ? 'Rent' : category })),
  entry_history: [
    { ...base, id: 1, source: 'cash', category: 'cash_sales', business_date: today, entry_type: 'cash_sale' },
    { ...base, id: 2, source: 'cash', category: 'cash_sales', business_date: previousDate, daily_report_id: 2, entry_type: 'cash_sale', amount: 200, created_at: '2020-01-01T06:00:00Z' },
    { ...base, id: 1, source: 'customer', category: 'credit', business_date: today, entry_type: 'credit_sale', party_id: 1, party_name: 'Alice' },
    { ...base, id: 2, source: 'customer', category: 'credit', business_date: today, entry_type: 'credit_recovery', party_id: 2, party_name: 'Bob', amount: 50 },
    { ...base, id: 1, source: 'supplier', category: 'supplier', business_date: today, entry_type: 'purchase', party_id: 1, party_name: 'Medicine Company' },
    { ...base, id: 2, source: 'supplier', category: 'supplier', business_date: today, entry_type: 'payment', party_id: 2, party_name: 'Other Company', amount: 50 },
    ...['cash_purchase', 'overhead', 'conveyance'].map((category, index) => ({ ...base, id: index + 1, source: 'transaction', category, business_date: today, entry_type: category, party_name: category === 'overhead' ? 'Rent' : category })),
  ],
}
const writes = []
const backend = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')
  response.setHeader('Content-Type', 'application/json')
  if (url.pathname === '/auth/v1/user') {
    const token = request.headers.authorization?.split(' ')[1]
    const identity = token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub : userId
    return response.end(JSON.stringify({ ...user, id: identity }))
  }
  if (url.pathname === '/rest/v1/rpc/entry_history_totals') {
    let body = ''
    for await (const chunk of request) body += chunk
    const params = JSON.parse(body)
    const rows = datasets.entry_history.filter((row) => (!params.p_category || row.category === params.p_category) && (!params.p_party_id || row.party_id === params.p_party_id) && (!params.p_business_date || row.business_date === params.p_business_date))
    const sum = (secondary) => rows.filter((row) => ['credit_recovery', 'payment'].includes(row.entry_type) === secondary).reduce((total, row) => total + row.amount, 0)
    return response.end(JSON.stringify([{ entry_count: rows.length, primary_total: sum(false), secondary_total: sum(true) }]))
  }
  if (request.method !== 'GET') {
    writes.push(`${request.method} ${url.pathname}`)
    response.statusCode = 400
    return response.end(JSON.stringify({ message: 'History checks must not write data' }))
  }
  const table = url.pathname.split('/').at(-1)
  let rows = datasets[table] || []
  for (const [field, value] of url.searchParams) {
    if (value.startsWith('eq.')) rows = rows.filter((row) => String(row[field]) === value.slice(3))
    if (value.startsWith('in.(')) rows = rows.filter((row) => value.slice(4, -1).split(',').includes(String(row[field])))
  }
  if (request.headers.accept?.includes('application/vnd.pgrst.object+json')) return response.end(JSON.stringify(rows[0] || null))
  response.end(JSON.stringify(rows))
})
backend.listen(0, '127.0.0.1')
await once(backend, 'listening')
const backendUrl = `http://127.0.0.1:${backend.address().port}`
const appPort = 4317
const appUrl = `http://127.0.0.1:${appPort}`
const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)), 'dev', '--port', String(appPort)], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true,
  env: { ...process.env, CASH_TOOL_PAGE_CHECK: '1', NEXT_PUBLIC_SUPABASE_URL: backendUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_test', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
child.stdout.on('data', (chunk) => { logs += chunk })
child.stderr.on('data', (chunk) => { logs += chunk })
const expiresAt = Math.floor(Date.now() / 1000) + 3600
function headersFor(id) {
  const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, exp: expiresAt, aud: 'authenticated', role: 'authenticated' })).toString('base64url')}.test`
  const session = { access_token: jwt, refresh_token: 'test-refresh', expires_at: expiresAt, expires_in: 3600, token_type: 'bearer', user: { ...user, id } }
  return { cookie: `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}` }
}
const headers = headersFor(userId)
const adminHeaders = headersFor(adminId)
const htmlOnly = (body) => body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
try {
  let ready = false
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(logs)
    try {
      await fetch(`${appUrl}/login`)
      ready = true
      break
    } catch { await new Promise((resolve) => setTimeout(resolve, 250)) }
  }
  assert.ok(ready, 'Next.js server started')
  for (const [path, title] of [['/cash-sales', 'Cash Sales'], ['/credit-recovery', 'Credit Sales / Recovery'], ['/supplier', 'Supplier'], ['/local-supplier', 'Local Supplier'], ['/overhead-cost', 'Overhead Cost'], ['/conveyance', 'Conveyance']]) {
    const response = await fetch(`${appUrl}${path}`, { headers })
    const html = htmlOnly(await response.text())
    assert.equal(response.status, 200, path)
    assert.ok(html.includes(`<h1>${title}</h1>`), `${path} shows its own history page`)
    assert.ok(html.includes('Date &amp; Time'), `${path} shows entry timestamps`)
    assert.ok(!html.includes('name="amount"') && !html.includes('name="cash_sales"'), `${path} has no entry forms`)
    assert.ok(html.includes('ledger-table') && html.includes('<thead>') && html.includes('<tfoot>'), `${path} preserves table headers and totals`)
    assert.ok(!html.includes('table-edit'), `${path} has no user edit controls`)
    console.log(`PASS ${path}: read-only history`)
  }
  for (const [path, keep, exclude] of [['/credit-recovery?party=1', 'Alice', 'Bob'], ['/supplier?party=1', 'Medicine Company', 'Other Company']]) {
    const html = htmlOnly(await (await fetch(`${appUrl}${path}`, { headers })).text())
    const table = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || ''
    assert.ok(table.includes(keep) && !table.includes(exclude), `${path} applies the name filter`)
    console.log(`PASS ${path}: name filter`)
  }
  const draftSummary = await fetch(`${appUrl}/summary`, { headers, redirect: 'manual' })
  const draftBody = await draftSummary.text()
  assert.ok(draftSummary.headers.get('location') === '/dashboard' || draftBody.includes('url=/dashboard'), 'draft summary redirects to dashboard')
  console.log('PASS /summary: draft report is unavailable')
  const dashboard = htmlOnly(await (await fetch(`${appUrl}/dashboard`, { headers })).text())
  assert.ok(dashboard.includes('Cash Earned Today') && dashboard.includes('<h2>Credit Sales</h2>'))
  assert.ok(!dashboard.includes('mini-totals') && !dashboard.includes('Edit entry') && !dashboard.includes('Delete entry'))
  assert.ok(dashboard.includes('Search company name'))
  console.log('PASS /dashboard: updated titles, supplier search, permanent entries')
  const secondDashboard = htmlOnly(await (await fetch(`${appUrl}/dashboard`, { headers: headersFor(secondUserId) })).text())
  const portal = (html) => html.match(/<div class="daily-entry-portal">([\s\S]*)/)?.[1]
  assert.equal(portal(dashboard), portal(secondDashboard), 'both users see exactly the same daily entries')
  console.log('PASS shared dashboard: both storekeepers see combined records')
  const adminDraft = htmlOnly(await (await fetch(`${appUrl}/admin/summary`, { headers: adminHeaders })).text())
  assert.ok(adminDraft.includes('No submitted report for this date.'))
  assert.ok(!adminDraft.includes('Financial Overview'))
  console.log('PASS admin summary: draft report withheld and no dashboard')
  report.status = 'submitted'
  const submitted = htmlOnly(await (await fetch(`${appUrl}/summary`, { headers })).text())
  assert.ok(submitted.includes('Submitted Summary'))
  const locked = htmlOnly(await (await fetch(`${appUrl}/dashboard`, { headers })).text())
  assert.ok(!locked.includes('name="cash_sales"') && !locked.includes('name="amount"'))
  console.log('PASS submission: summary available and entry forms closed')
  report.business_date = '2020-01-01'
  const nextDay = htmlOnly(await (await fetch(`${appUrl}/dashboard`, { headers })).text())
  assert.ok(nextDay.includes('No cash sales entries today.') && nextDay.includes('No credit entries today.'))
  console.log('PASS dashboard: previous days disappear from today')
  report.business_date = today
  for (const path of ['/cash-sales', '/credit-recovery', '/supplier', '/local-supplier', '/overhead-cost', '/conveyance']) {
    const response = await fetch(`${appUrl}/admin${path}`, { headers: adminHeaders })
    const html = htmlOnly(await response.text())
    assert.equal(response.status, 200, `/admin${path}`)
    assert.ok(html.includes('table-edit') && html.includes('Actions'), `/admin${path} has row editing`)
    assert.ok(html.includes('name="date"'), `/admin${path} has a date filter`)
    console.log(`PASS /admin${path}: editable table`)
  }
  const adminToday = htmlOnly(await (await fetch(`${appUrl}/admin/summary`, { headers: adminHeaders })).text())
  assert.ok(adminToday.includes('Submitted Entries') && adminToday.includes('table-edit'))
  const adminPast = htmlOnly(await (await fetch(`${appUrl}/admin/summary?date=${previousDate}`, { headers: adminHeaders })).text())
  assert.ok(adminPast.includes('1 shared entries') && adminPast.includes('৳200.00'))
  const pastTables = [...adminPast.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)]
  assert.ok(!pastTables.at(-1)[1].includes('Alice'), 'date-selected summary excludes other days')
  console.log('PASS admin summary: today and date-selected submitted records')
  const userAdmin = await fetch(`${appUrl}/admin/summary`, { headers, redirect: 'manual' })
  const userAdminBody = await userAdmin.text()
  assert.ok(userAdmin.headers.get('location') === '/dashboard' || userAdminBody.includes('url=/dashboard'))
  const adminDashboard = await fetch(`${appUrl}/dashboard`, { headers: adminHeaders, redirect: 'manual' })
  const adminDashboardBody = await adminDashboard.text()
  assert.ok(adminDashboard.headers.get('location') === '/admin/summary' || adminDashboardBody.includes('url=/admin/summary'))
  console.log('PASS roles: storekeepers cannot access admin and admin starts at summary')
  assert.deepEqual(writes, [], 'history GET requests do not mutate data')
} catch (error) {
  console.error(logs.slice(-5000))
  throw error
} finally {
  child.kill()
  backend.closeAllConnections()
  backend.close()
}
