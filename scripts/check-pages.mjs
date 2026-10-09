import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { encodeReply } from 'next/dist/compiled/react-server-dom-turbopack/client.node.js'
import { businessDate, formatDate, taka } from '../src/lib/format.js'

// Exercise the actual Next.js pages against a local Supabase API fixture.
// No project credentials or external Supabase requests are used.
const userId = '11111111-1111-4111-8111-111111111111'
const secondUserId = '33333333-3333-4333-8333-333333333333'
const adminId = '22222222-2222-4222-8222-222222222222'
const timestamp = new Date().toISOString()
const today = businessDate()
const yesterdayValue = new Date(`${today}T00:00:00Z`)
yesterdayValue.setUTCDate(yesterdayValue.getUTCDate() - 1)
const yesterday = yesterdayValue.toISOString().slice(0, 10)
const profile = { id: userId, full_name: 'User', username: 'user', role: 'user' }
const profiles = [profile, { ...profile, id: secondUserId, full_name: 'Second User', username: 'user2' }, { ...profile, id: adminId, full_name: 'Administrator', username: 'admin', role: 'superadmin' }]
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'user@pharmacy.local', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: timestamp }
const report = { id: 1, business_date: today, status: 'draft', cash_sales: 100, updated_at: timestamp, submitted_at: timestamp }
const previousDate = '2020-01-01'
const previousReport = { ...report, id: 2, business_date: previousDate, status: 'submitted', cash_sales: 200, cash_in_hand: 200 }
const yesterdayReport = { ...report, id: 3, business_date: yesterday, status: 'submitted', cash_sales: 100, cash_in_hand: -50 }
const base = { daily_report_id: 1, amount: 100, created_by: userId, created_at: timestamp }
const datasets = {
  profiles, daily_reports: [report, previousReport, yesterdayReport],
  admin_report_summary: [
    { id: 1, business_date: today, cash_sales: 100, credit_sales: 100, credit_recovery: 0, supplier_purchases: 100, supplier_payments: 0, cash_purchases: 100, overhead_cost: 100, conveyance: 100 },
    { id: 2, business_date: previousDate, cash_sales: 200, credit_sales: 0, credit_recovery: 0, supplier_purchases: 0, supplier_payments: 0, cash_purchases: 0, overhead_cost: 0, conveyance: 0 },
  ],
  customers: [{ id: 1, name: 'Alice', active: true, created_at: timestamp }, { id: 2, name: 'Bob', active: true, created_at: timestamp }, { id: 3, name: 'New Person', phone_number: '01700000000', active: true, created_at: timestamp }],
  suppliers: [{ id: 1, name: 'Medicine Company', active: true, created_at: timestamp }, { id: 2, name: 'Other Company', active: true, created_at: timestamp }, { id: 3, name: 'New Company', active: true, created_at: timestamp }],
  overhead_categories: [{ id: 1, name: 'Rent', active: true, created_at: timestamp }, { id: 2, name: 'Cash Drawn', active: true, created_at: timestamp }],
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
const additions = []
let cashSchemaAvailable = true
function cashBalances() {
  let balance = 0
  return datasets.daily_reports.filter((row) => ['submitted', 'approved'].includes(row.status))
    .sort((a, b) => a.business_date.localeCompare(b.business_date))
    .map((row) => {
      balance += Number(row.cash_in_hand || 0)
      return { ...row, total_sales: row.cash_sales, daily_cash_change: row.cash_in_hand, cash_in_hand: balance }
    })
}
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
  if (url.pathname === '/rest/v1/rpc/cash_sales_history_totals') {
    if (!cashSchemaAvailable) {
      response.statusCode = 404
      return response.end(JSON.stringify({ code: 'PGRST202', message: 'Function is not in the schema cache' }))
    }
    const rows = cashBalances().filter((row) => row.business_date <= today)
    return response.end(JSON.stringify([{ report_count: rows.length, total_sales: rows.reduce((sum, row) => sum + row.total_sales, 0), cash_in_hand: rows.at(-1)?.cash_in_hand || 0 }]))
  }
  if (url.pathname === '/rest/v1/rpc/admin_add_history_record') {
    let body = ''
    for await (const chunk of request) body += chunk
    const params = JSON.parse(body)
    additions.push(params)
    const table = params.p_category === 'credit' ? 'customers' : params.p_category === 'supplier' ? 'suppliers' : 'overhead_categories'
    if (datasets[table].some((row) => row.name.toLowerCase() === params.p_name.toLowerCase())) {
      response.statusCode = 409
      return response.end(JSON.stringify({ code: '23505', message: 'Name already exists' }))
    }
    const id = Math.max(...datasets[table].map((row) => row.id)) + 1
    datasets[table].push({ id, name: params.p_name, phone_number: params.p_phone_number, active: true, created_at: timestamp })
    if (params.p_amount !== null) datasets.entry_history.push({
      ...base, id: 1000 + additions.length, source: params.p_category === 'credit' ? 'customer' : 'supplier',
      category: params.p_category, party_id: id, party_name: params.p_name, entry_type: params.p_entry_type,
      amount: params.p_amount, business_date: params.p_business_date,
      daily_report_id: datasets.daily_reports.find((row) => row.business_date === params.p_business_date)?.id,
      phone_number: params.p_phone_number, created_by: adminId,
    })
    return response.end(JSON.stringify(id))
  }
  if (request.method !== 'GET') {
    writes.push(`${request.method} ${url.pathname}`)
    response.statusCode = 400
    return response.end(JSON.stringify({ message: 'History checks must not write data' }))
  }
  const table = url.pathname.split('/').at(-1)
  if (table === 'daily_cash_balances' && !cashSchemaAvailable) {
    response.statusCode = 404
    return response.end(JSON.stringify({ code: 'PGRST205', message: 'View is not in the schema cache' }))
  }
  let rows = table === 'daily_cash_balances' ? cashBalances() : datasets[table] || []
  const relations = { customers: 'customer_ledger_entries', suppliers: 'supplier_ledger_entries', overhead_categories: 'transactions' }
  if (relations[table]) rows = rows.map((row) => ({
    ...row,
    [relations[table]]: datasets.entry_history.filter((entry) => table === 'customers'
      ? entry.source === 'customer' && entry.party_id === row.id
      : table === 'suppliers' ? entry.source === 'supplier' && entry.party_id === row.id
        : entry.category === 'overhead' && entry.party_name === row.name),
  }))
  for (const [field, value] of url.searchParams) {
    if (value.startsWith('eq.')) rows = rows.filter((row) => String(row[field]) === value.slice(3))
    if (value.startsWith('in.(')) rows = rows.filter((row) => value.slice(4, -1).split(',').includes(String(row[field])))
    if (value.startsWith('lt.')) rows = rows.filter((row) => String(row[field]) < value.slice(3))
    if (value.startsWith('lte.')) rows = rows.filter((row) => String(row[field]) <= value.slice(4))
    if (value.startsWith('gte.')) rows = rows.filter((row) => String(row[field]) >= value.slice(4))
    if (value === 'is.null') rows = rows.filter((row) => row[field] == null || row[field].length === 0)
  }
  const order = url.searchParams.get('order')?.split(',') || []
  rows = [...rows].sort((a, b) => {
    for (const item of order) {
      const [field, direction] = item.split('.')
      const comparison = a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0
      if (comparison) return direction === 'desc' ? -comparison : comparison
    }
    return 0
  })
  const offset = Number(url.searchParams.get('offset') || 0)
  const limit = Number(url.searchParams.get('limit') || rows.length)
  rows = rows.slice(offset, offset + limit)
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
  for (const [path, title] of [['/cash-sales', 'Cash Sales'], ['/credit-recovery', 'Due Amount / Due Recovery'], ['/supplier', 'Supplier'], ['/local-supplier', 'Local Supplier'], ['/overhead-cost', 'Overhead Cost'], ['/conveyance', 'Conveyance']]) {
    const response = await fetch(`${appUrl}${path}`, { headers })
    const html = htmlOnly(await response.text())
    assert.equal(response.status, 200, path)
    assert.ok(html.includes(`<h1>${title}</h1>`), `${path} shows its own history page`)
    if (path === '/cash-sales') {
      const heading = html.match(/<thead>([\s\S]*?)<\/thead>/)?.[1]
      assert.ok(heading.includes('Date') && heading.includes('Total Sales') && heading.includes('Cash in Hand'))
      const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]
      assert.equal([...body.matchAll(/<tr>/g)].length, 2, 'cash history has one row per submitted day')
      assert.ok(body.includes(taka(150)) && body.includes(taka(200)), 'daily rows show cumulative closing balances')
      assert.ok(!body.includes(`dateTime="${today}"`), 'draft days are excluded')
    } else assert.ok(html.includes('Date &amp; Time'), `${path} shows entry timestamps`)
    assert.ok(!html.includes('name="amount"') && !html.includes('name="cash_sales"'), `${path} has no entry forms`)
    assert.ok(html.includes('ledger-table') && html.includes('<thead>') && html.includes('<tfoot>'), `${path} preserves table headers and totals`)
    if (path === '/credit-recovery' || path === '/supplier') assert.ok(html.includes('Phone Number') && html.includes('Notes'), `${path} shows contact numbers and notes`)
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
  assert.ok(dashboard.includes('Cash earned today') && dashboard.includes('<h2>Due Amount</h2>'))
  assert.ok(dashboard.includes('Calculate Cash in Hand') && dashboard.includes('previous-cash-card card positive'))
  assert.ok(dashboard.includes(`Running balance through ${formatDate(yesterday, true)}`) && dashboard.includes(taka(150)))
  assert.ok(!/storekeeper/i.test(dashboard), 'the default account is displayed as User')
  assert.ok(!dashboard.includes('mini-totals') && !dashboard.includes('Edit entry') && !dashboard.includes('Delete entry'))
  assert.ok(dashboard.includes('Search company name'))
  console.log('PASS /dashboard: updated titles, supplier search, permanent entries')
  const secondDashboard = htmlOnly(await (await fetch(`${appUrl}/dashboard`, { headers: headersFor(secondUserId) })).text())
  const portal = (html) => html.match(/<div class="daily-entry-portal">([\s\S]*)/)?.[1]
  assert.equal(portal(dashboard), portal(secondDashboard), 'both users see exactly the same daily entries')
  console.log('PASS shared dashboard: both users see combined records')
  cashSchemaAvailable = false
  profile.full_name = 'Storekeeper'
  const compatibleDashboard = htmlOnly(await (await fetch(`${appUrl}/dashboard`, { headers })).text())
  assert.ok(compatibleDashboard.includes(taka(150)) && !/storekeeper/i.test(compatibleDashboard))
  const compatibleHistory = htmlOnly(await (await fetch(`${appUrl}/cash-sales`, { headers })).text())
  assert.ok(compatibleHistory.includes(taka(150)) && compatibleHistory.includes('Cash in Hand'))
  cashSchemaAvailable = true
  profile.full_name = 'User'
  console.log('PASS existing database: cash balances and User labels work before migration 009')
  datasets.daily_reports = [report, previousReport]
  const gapDashboard = htmlOnly(await (await fetch(`${appUrl}/dashboard`, { headers })).text())
  assert.ok(gapDashboard.includes(`Running balance through ${formatDate(previousDate, true)}`) && gapDashboard.includes(taka(200)))
  datasets.daily_reports = [report]
  const emptyDashboard = htmlOnly(await (await fetch(`${appUrl}/dashboard`, { headers })).text())
  assert.ok(emptyDashboard.includes('Starting balance') && emptyDashboard.includes('previous-cash-card card neutral'))
  const emptyHistory = htmlOnly(await (await fetch(`${appUrl}/cash-sales`, { headers })).text())
  assert.ok(emptyHistory.includes('No submitted reports yet.'))
  datasets.daily_reports = [report, previousReport, yesterdayReport]
  console.log('PASS running balance: carries across gaps and starts at zero without submitted reports')
  const adminDraft = htmlOnly(await (await fetch(`${appUrl}/admin/summary`, { headers: adminHeaders })).text())
  assert.ok(adminDraft.includes('No submitted report for this date.'))
  assert.ok(!adminDraft.includes('Financial Overview'))
  console.log('PASS admin summary: draft report withheld and no dashboard')
  report.status = 'submitted'
  report.cash_in_hand = 100
  const submitted = htmlOnly(await (await fetch(`${appUrl}/summary`, { headers })).text())
  assert.ok(submitted.includes('Submitted Summary'))
  assert.ok(submitted.includes(taka(250)) && submitted.includes('Running balance through this report'))
  const locked = htmlOnly(await (await fetch(`${appUrl}/dashboard`, { headers })).text())
  assert.ok(!locked.includes('name="cash_sales"') && !locked.includes('name="amount"'))
  const lockedCard = locked.match(/<section class="previous-cash-card[\s\S]*?<\/section>/)?.[0]
  assert.ok(lockedCard.includes(taka(250)))
  assert.ok(locked.includes('Submitted Cash in Hand') && locked.includes(taka(250)))
  console.log('PASS submission: summary available and entry forms closed')
  report.business_date = '2020-01-01'
  const nextDay = htmlOnly(await (await fetch(`${appUrl}/dashboard`, { headers })).text())
  assert.ok(nextDay.includes('No cash sales entries today.') && nextDay.includes('No due entries today.'))
  console.log('PASS dashboard: previous days disappear from today')
  report.business_date = today
  for (const path of ['/cash-sales', '/credit-recovery', '/supplier', '/local-supplier', '/overhead-cost', '/conveyance']) {
    const response = await fetch(`${appUrl}/admin${path}`, { headers: adminHeaders })
    const html = htmlOnly(await response.text())
    assert.equal(response.status, 200, `/admin${path}`)
    assert.ok(html.includes('table-edit') && html.includes('Actions'), `/admin${path} has row editing`)
    assert.ok(html.includes('name="date"'), `/admin${path} has a date filter`)
    const additions = { '/credit-recovery': ['Add Person', 'New Person'], '/supplier': ['Add Supplier Name', 'New Company'], '/overhead-cost': ['Add Overhead', 'Cash Drawn'] }
    if (additions[path]) {
      const [button, name] = additions[path]
      const heading = html.match(/<header class="page-heading">([\s\S]*?)<\/header>/)?.[1]
      assert.ok(heading.includes(button) && !heading.includes('Daily Summary'), `/admin${path} replaces the header link with its add button`)
      const rows = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]
      const nameRow = [...rows.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((match) => match[1]).find((row) => row.includes(name))
      assert.ok(nameRow.includes('No entries yet') && !nameRow.includes('table-edit') && !nameRow.includes(taka(0)), 'name-only records show blank amounts without entry edit controls')
      const past = htmlOnly(await (await fetch(`${appUrl}/admin${path}?date=${previousDate}`, { headers: adminHeaders })).text())
      assert.ok(!past.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]?.includes(name), 'the date filter excludes names created on other days')
    }
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
  console.log('PASS roles: users cannot access admin and admin starts at summary')
  const savedReports = datasets.daily_reports
  const manyReports = Array.from({ length: 60 }, (_, index) => {
    const date = new Date('2021-01-01T00:00:00Z')
    date.setUTCDate(date.getUTCDate() + index)
    return { ...previousReport, id: 100 + index, business_date: date.toISOString().slice(0, 10), cash_sales: 10, cash_in_hand: 1 }
  })
  datasets.daily_reports = manyReports
  const secondPage = htmlOnly(await (await fetch(`${appUrl}/cash-sales?page=2`, { headers })).text())
  const pageBody = secondPage.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]
  const footer = secondPage.match(/<tfoot>([\s\S]*?)<\/tfoot>/)?.[1]
  assert.equal([...pageBody.matchAll(/<tr>/g)].length, 10)
  assert.ok(secondPage.includes('Page 2 of 2') && footer.includes(taka(600)) && footer.includes(taka(60)))
  assert.ok(pageBody.includes(taka(10)) && pageBody.includes(taka(1)), 'page two retains full-history running balances')
  datasets.daily_reports = savedReports
  console.log('PASS cash sales pagination: older days retain balances and totals cover every day')
  cashSchemaAvailable = false
  const longHistory = Array.from({ length: 1005 }, (_, index) => {
    const date = new Date('2021-01-01T00:00:00Z')
    date.setUTCDate(date.getUTCDate() + index)
    return { ...previousReport, id: 100 + index, business_date: date.toISOString().slice(0, 10), cash_sales: 10, cash_in_hand: 1 }
  })
  datasets.daily_reports = longHistory
  const lastPage = htmlOnly(await (await fetch(`${appUrl}/cash-sales?page=21`, { headers })).text())
  const longFooter = lastPage.match(/<tfoot>([\s\S]*?)<\/tfoot>/)?.[1]
  assert.ok(lastPage.includes('Page 21 of 21') && longFooter.includes(taka(10050)) && longFooter.includes(taka(1005)))
  assert.equal([...lastPage.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].matchAll(/<tr>/g)].length, 5)
  datasets.daily_reports = savedReports
  cashSchemaAvailable = true
  console.log('PASS existing database pagination: balances include reports beyond the API row limit')
  assert.deepEqual(writes, [], 'history GET requests do not mutate data')
  assert.deepEqual(additions, [], 'read-only page checks do not add records')
  const manifest = JSON.parse(await readFile(new URL('../.next-page-check/dev/server/server-reference-manifest.json', import.meta.url), 'utf8'))
  const actionId = Object.entries(manifest.node).find(([, action]) => action.exportedName === 'adminAddHistoryRecordAction')?.[0]
  assert.ok(actionId, 'the admin add form has a compiled server action')
  async function submitAddition(values, actorHeaders = adminHeaders) {
    const form = new FormData()
    for (const [key, value] of Object.entries(values)) form.set(key, value)
    const body = await encodeReply([null, form])
    const response = await fetch(`${appUrl}/admin/credit-recovery`, { method: 'POST', headers: { ...actorHeaders, 'Next-Action': actionId, origin: appUrl }, body, redirect: 'manual' })
    return { response, body: await response.text() }
  }
  for (const values of [
    { category: 'credit', name: 'Added Person', phone_number: '01900000000', business_date: previousDate },
    { category: 'supplier', name: 'Added Company', entry_type: 'purchase', amount: '42', business_date: previousDate },
    { category: 'overhead', name: 'Owner Cash Drawn', business_date: today },
  ]) {
    const result = await submitAddition(values)
    assert.equal(result.response.status, 200)
    assert.ok(result.body.includes(`${values.name} added.`), `${values.category} saves through the real server action`)
  }
  assert.equal(additions[0].p_amount, null)
  assert.equal(additions[1].p_business_date, previousDate, 'optional amounts preserve the selected report date')
  assert.equal(additions[1].p_amount, 42)
  const savedPerson = htmlOnly(await (await fetch(`${appUrl}/admin/credit-recovery`, { headers: adminHeaders })).text())
  assert.ok(savedPerson.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].includes('Added Person'))
  const savedSupplier = htmlOnly(await (await fetch(`${appUrl}/admin/supplier?date=${previousDate}`, { headers: adminHeaders })).text())
  assert.ok(savedSupplier.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].includes('Added Company') && savedSupplier.includes(taka(42)))
  const savedOverhead = htmlOnly(await (await fetch(`${appUrl}/admin/overhead-cost`, { headers: adminHeaders })).text())
  assert.ok(savedOverhead.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].includes('Owner Cash Drawn'))
  const duplicate = await submitAddition({ category: 'credit', name: 'Added Person' })
  assert.ok(duplicate.body.includes('That name already exists.'))
  const beforeInvalid = additions.length
  const invalid = await submitAddition({ category: 'supplier', name: 'Invalid Amount', entry_type: 'purchase', amount: '-1' })
  assert.ok(invalid.body.includes('Enter an amount greater than zero'))
  const missingType = await submitAddition({ category: 'credit', name: 'Missing Type', amount: '10' })
  assert.ok(missingType.body.includes('Select an entry type for the amount.'))
  const forbidden = await submitAddition({ category: 'overhead', name: 'Forbidden User Addition' }, headers)
  assert.ok(forbidden.response.headers.get('x-action-redirect')?.startsWith('/dashboard') || forbidden.body.includes('/dashboard'))
  assert.equal(additions.length, beforeInvalid, 'invalid and user submissions never reach the write RPC')
  assert.deepEqual(writes, [], 'admin additions use only the intended transactional RPC')
  console.log('PASS admin add forms: real server actions save names and selected-date amounts, reject duplicates, and enforce permissions')
} catch (error) {
  console.error(logs.slice(-5000))
  throw error
} finally {
  child.kill()
  backend.closeAllConnections()
  backend.close()
}
