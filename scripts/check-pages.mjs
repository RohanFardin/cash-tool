import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { encodeReply } from 'next/dist/compiled/react-server-dom-turbopack/client.node.js'
import { businessDate, formatDate, taka } from '../src/lib/format.js'
import { readSheet } from 'read-excel-file/node'

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
const profile = { id: userId, full_name: 'User', username: 'user', role: 'user', entry_editing_enabled: false }
const profiles = [profile, { ...profile, id: secondUserId, full_name: 'Second User', username: 'user2' }, { ...profile, id: adminId, full_name: 'Administrator', username: 'admin', role: 'superadmin' }]
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'user@pharmacy.local', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: timestamp }
const report = { id: 1, business_date: today, status: 'draft', cash_sales: 100, updated_at: timestamp, submitted_at: timestamp, submitted_by: userId }
const previousDate = '2020-01-01'
const previousReport = { ...report, id: 2, business_date: previousDate, status: 'submitted', cash_sales: 200, cash_in_hand: 200, submitted_by: secondUserId }
const yesterdayReport = { ...report, id: 3, business_date: yesterday, status: 'submitted', cash_sales: 100, cash_in_hand: -50 }
const base = { daily_report_id: 1, amount: 100, created_by: userId, created_at: timestamp }
const datasets = {
  profiles, daily_reports: [report, previousReport, yesterdayReport],
  admin_report_summary: [
    { id: 1, business_date: today, cash_sales: 100, credit_sales: 100, credit_recovery: 0, supplier_purchases: 100, supplier_payments: 0, cash_purchases: 100, overhead_cost: 100, conveyance: 100 },
    { id: 2, business_date: previousDate, cash_sales: 200, credit_sales: 0, credit_recovery: 0, supplier_purchases: 0, supplier_payments: 0, cash_purchases: 0, overhead_cost: 0, conveyance: 0 },
    { id: 3, business_date: yesterday, cash_sales: 100, credit_sales: 0, credit_recovery: 0, supplier_purchases: 0, supplier_payments: 150, cash_purchases: 0, overhead_cost: 0, conveyance: 0 },
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
const adminBatches = []
const userBatches = []
const partyAdditions = []
const deletions = []
const passwordChanges = []
const profileUpdates = []
const entryEdits = []
// Synthetic credentials used only by the local Auth fixture.
const fixtureSecret = 'sb_secret_local_test_only'
const passwords = new Map([[adminId, 'LocalAdminOld12!'], [userId, 'LocalUserOld12!'], [secondUserId, 'LocalSecondOld12!']])
let passwordErrorCode = null
let cashSchemaAvailable = true
let historySchema = 'current'
let historyRowLimit = Infinity
let exportRowLimit = Infinity
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
  response.setHeader('X-Supabase-Api-Version', '2024-01-01')
  if (url.pathname === '/rest/v1/rpc/admin_edit_entry') {
    let body = ''
    for await (const chunk of request) body += chunk
    const params = JSON.parse(body)
    const identity = JSON.parse(Buffer.from(request.headers.authorization.split(' ')[1].split('.')[1], 'base64url').toString()).sub
    if (!profiles.some((profile) => profile.id === identity && profile.role === 'superadmin' && profile.entry_editing_enabled)) {
      response.statusCode = 403
      return response.end(JSON.stringify({ code: 'P0001', message: 'Enable entry editing in Settings' }))
    }
    entryEdits.push(params)
    const entry = datasets.entry_history.find((row) => row.source === params.p_source && row.id === params.p_id)
    entry.amount = params.p_amount
    return response.end(JSON.stringify(entry.business_date))
  }
  if (url.pathname === '/auth/v1/user') {
    const token = request.headers.authorization?.split(' ')[1]
    const identity = token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub : userId
    if (request.method === 'PUT') {
      let body = ''
      for await (const chunk of request) body += chunk
      const values = JSON.parse(body)
      if (passwordErrorCode) {
        response.statusCode = 422
        return response.end(JSON.stringify({ code: passwordErrorCode, msg: 'Password update rejected' }))
      }
      passwords.set(identity, values.password)
      passwordChanges.push({ id: identity, password: values.password, admin: false })
    }
    return response.end(JSON.stringify(authUser(identity)))
  }
  if (url.pathname === '/auth/v1/token') {
    let body = ''
    for await (const chunk of request) body += chunk
    const values = JSON.parse(body)
    const account = profiles.find((profile) => authUser(profile.id).email === values.email)
    if (!account || passwords.get(account.id) !== values.password) {
      response.statusCode = 400
      return response.end(JSON.stringify({ code: 'invalid_credentials', msg: 'Invalid credentials' }))
    }
    return response.end(JSON.stringify(sessionFor(account.id)))
  }
  if (url.pathname.startsWith('/auth/v1/admin/users/') && request.method === 'PUT') {
    assert.equal(request.headers.apikey, fixtureSecret, 'user resets use the server-only key')
    assert.equal(request.headers.authorization, `Bearer ${fixtureSecret}`)
    const identity = url.pathname.split('/').at(-1)
    let body = ''
    for await (const chunk of request) body += chunk
    const values = JSON.parse(body)
    assert.deepEqual(Object.keys(values), ['password'], 'password resets do not change account roles or metadata')
    passwords.set(identity, values.password)
    passwordChanges.push({ id: identity, password: values.password, admin: true })
    return response.end(JSON.stringify({ user: authUser(identity) }))
  }
  if (url.pathname === '/rest/v1/rpc/admin_delete_daily_report') {
    let body = ''
    for await (const chunk of request) body += chunk
    const params = JSON.parse(body)
    const selected = datasets.daily_reports.find((row) => row.id === params.p_report_id && row.business_date === params.p_business_date && row.status !== 'draft')
    if (!selected) {
      response.statusCode = 400
      return response.end(JSON.stringify({ code: 'P0001', message: 'Submitted report is not available' }))
    }
    deletions.push(params)
    for (const table of ['cash_sales_entries', 'customer_ledger_entries', 'supplier_ledger_entries', 'transactions', 'entry_history']) {
      datasets[table] = datasets[table].filter((row) => row.daily_report_id !== selected.id)
    }
    datasets.daily_reports = datasets.daily_reports.filter((row) => row.id !== selected.id)
    datasets.admin_report_summary = datasets.admin_report_summary.filter((row) => row.id !== selected.id)
    return response.end(JSON.stringify(selected.id))
  }
  if (url.pathname === '/rest/v1/rpc/entry_history_totals') {
    let body = ''
    for await (const chunk of request) body += chunk
    const params = JSON.parse(body)
    if (historySchema === 'missing' || (historySchema === 'previous' && 'p_date_from' in params)) {
      response.statusCode = 404
      return response.end(JSON.stringify({ code: 'PGRST202', message: 'History function signature is not in the schema cache' }))
    }
    const rows = datasets.entry_history.filter((row) => (!params.p_category || row.category === params.p_category) && (!params.p_party_id || row.party_id === params.p_party_id) && (!params.p_business_date || row.business_date === params.p_business_date) && (!params.p_date_from || row.business_date >= params.p_date_from) && (!params.p_date_to || row.business_date <= params.p_date_to))
    const sum = (secondary) => rows.filter((row) => ['credit_recovery', 'payment'].includes(row.entry_type) === secondary).reduce((total, row) => total + row.amount, 0)
    return response.end(JSON.stringify([{ entry_count: rows.length, primary_total: sum(false), secondary_total: sum(true) }]))
  }
  if (url.pathname === '/rest/v1/rpc/cash_sales_history_totals') {
    let body = ''
    for await (const chunk of request) body += chunk
    const params = body ? JSON.parse(body) : {}
    if (!cashSchemaAvailable) {
      response.statusCode = 404
      return response.end(JSON.stringify({ code: 'PGRST202', message: 'Function is not in the schema cache' }))
    }
    const rows = cashBalances().filter((row) => row.business_date <= today && (!params.p_date_from || row.business_date >= params.p_date_from) && (!params.p_date_to || row.business_date <= params.p_date_to))
    return response.end(JSON.stringify([{ report_count: rows.length, total_sales: rows.reduce((sum, row) => sum + row.total_sales, 0), cash_in_hand: rows.at(-1)?.cash_in_hand || 0 }]))
  }
  if (url.pathname === '/rest/v1/rpc/admin_save_staged_report') {
    let body = ''
    for await (const chunk of request) body += chunk
    const params = JSON.parse(body)
    adminBatches.push(params)
    const saved = datasets.daily_reports.find((row) => row.business_date === params.p_business_date)
    for (const [index, entry] of params.p_entries.entries()) {
      const row = { ...base, id: 2000 + adminBatches.length * 100 + index, amount: entry.amount, daily_report_id: saved.id, created_by: adminId }
      if (entry.kind === 'cash') {
        datasets.cash_sales_entries.push({ ...row, entry_type: 'cash_sale' })
        datasets.entry_history.push({ ...row, source: 'cash', category: 'cash_sales', entry_type: 'cash_sale', business_date: saved.business_date })
        saved.cash_sales += entry.amount
        saved.cash_in_hand += entry.amount
      } else {
        datasets.transactions.push({ ...row, category: entry.category, name: entry.category })
        datasets.entry_history.push({ ...row, source: 'transaction', category: entry.category, entry_type: entry.category, business_date: saved.business_date })
        saved.cash_in_hand -= entry.amount
      }
    }
    return response.end(JSON.stringify(saved.id))
  }
  if (url.pathname === '/rest/v1/rpc/submit_staged_report') {
    let body = ''
    for await (const chunk of request) body += chunk
    userBatches.push(JSON.parse(body))
    return response.end(JSON.stringify(report.id))
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
  const table = url.pathname.split('/').at(-1)
  if (request.method === 'POST' && ['customers', 'suppliers'].includes(table)) {
    let body = ''
    for await (const chunk of request) body += chunk
    const values = JSON.parse(body)
    if (datasets[table].some((row) => row.name.toLowerCase() === values.name.toLowerCase())) {
      response.statusCode = 409
      return response.end(JSON.stringify({ code: '23505', message: 'Name already exists' }))
    }
    const saved = { ...values, id: datasets[table].length + 1, active: true, created_at: timestamp }
    datasets[table].push(saved)
    datasets[table === 'customers' ? 'customer_balances' : 'supplier_balances'].push({ ...saved, current_due: 0 })
    partyAdditions.push({ table, ...saved })
    return response.end(JSON.stringify(saved))
  }
  if (table === 'profiles' && request.method === 'PATCH') {
    const token = request.headers.authorization.split(' ')[1]
    const identity = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub
    assert.equal(profiles.find((profile) => profile.id === identity)?.role, 'superadmin')
    let body = ''
    for await (const chunk of request) body += chunk
    const values = JSON.parse(body)
    assert.ok(Object.keys(values).every((key) => ['full_name', 'entry_editing_enabled'].includes(key)), 'settings never change usernames or roles')
    const matched = profiles.filter((profile) => [...url.searchParams].every(([field, value]) => !value.startsWith('eq.') || String(profile[field]) === value.slice(3)))
    for (const profile of matched) {
      Object.assign(profile, values)
      profileUpdates.push({ id: profile.id, values })
    }
    return response.end(JSON.stringify(request.headers.accept?.includes('application/vnd.pgrst.object+json') ? matched[0] || null : matched))
  }
  if (request.method !== 'GET') {
    writes.push(`${request.method} ${url.pathname}`)
    response.statusCode = 400
    return response.end(JSON.stringify({ message: 'History checks must not write data' }))
  }
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
  if (table === 'entry_history') rows = rows.slice(0, historyRowLimit)
  if (['daily_reports', 'admin_report_summary'].includes(table)) rows = rows.slice(0, exportRowLimit)
  if (request.headers.accept?.includes('application/vnd.pgrst.object+json')) return response.end(JSON.stringify(rows[0] || null))
  response.end(JSON.stringify(rows))
})
backend.listen(0, '127.0.0.1')
await once(backend, 'listening')
const backendUrl = `http://127.0.0.1:${backend.address().port}`
const appPort = 4317
const appUrl = `http://localhost:${appPort}`
const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)), 'dev', '--port', String(appPort)], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true,
  env: { ...process.env, CASH_TOOL_PAGE_CHECK: '1', NEXT_PUBLIC_SUPABASE_URL: backendUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_test', SUPABASE_SECRET_KEY: fixtureSecret, SUPABASE_SERVICE_ROLE_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
child.stdout.on('data', (chunk) => { logs += chunk })
child.stderr.on('data', (chunk) => { logs += chunk })
const expiresAt = Math.floor(Date.now() / 1000) + 3600
function authUser(id) {
  return { ...user, id, email: `${profiles.find((profile) => profile.id === id)?.username || 'unknown'}@pharmacy.local` }
}
function sessionFor(id) {
  const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, exp: expiresAt, aud: 'authenticated', role: 'authenticated' })).toString('base64url')}.test`
  return { access_token: jwt, refresh_token: 'test-refresh', expires_at: expiresAt, expires_in: 3600, token_type: 'bearer', user: authUser(id) }
}
function headersFor(id) {
  return { cookie: `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(sessionFor(id))).toString('base64url')}` }
}
const headers = headersFor(userId)
const adminHeaders = headersFor(adminId)
const htmlOnly = (body) => body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
let browserEditingChanges = []
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
    assert.ok(html.includes('name="from"') && html.includes('name="to"'), `${path} has date range controls`)
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
  assert.ok(!dashboard.includes('entry-shortcuts'), 'dashboard shortcuts are removed')
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
  assert.ok(submitted.includes(taka(250)) && submitted.includes('Closing balance through this report'))
  assert.ok(submitted.includes('Yesterday’s Cash in Hand') && submitted.includes(taka(150)), 'submitted user summary includes yesterday’s closing cash')
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
  const adminProfile = profiles.find((profile) => profile.id === adminId)
  for (const path of ['/summary', '/cash-sales', '/credit-recovery', '/supplier', '/local-supplier', '/overhead-cost', '/conveyance']) {
    const readonly = htmlOnly(await (await fetch(`${appUrl}/admin${path}`, { headers: adminHeaders })).text())
    assert.ok(!readonly.includes('table-edit') && !readonly.includes('>Actions<'), `${path} hides entry editing when it is off`)
  }
  delete adminProfile.entry_editing_enabled
  const awaitingMigration = htmlOnly(await (await fetch(`${appUrl}/admin/settings`, { headers: adminHeaders })).text())
  assert.ok(awaitingMigration.includes('Apply migration 013') && awaitingMigration.includes('Change My Password'), 'pending migration keeps admin signed in with editing unavailable')
  adminProfile.entry_editing_enabled = true
  for (const path of ['/cash-sales', '/credit-recovery', '/supplier', '/local-supplier', '/overhead-cost', '/conveyance']) {
    const response = await fetch(`${appUrl}/admin${path}`, { headers: adminHeaders })
    const html = htmlOnly(await response.text())
    assert.equal(response.status, 200, `/admin${path}`)
    assert.ok(html.includes('table-edit') && html.includes('Actions'), `/admin${path} has row editing`)
    assert.ok(html.includes('name="from"') && html.includes('name="to"'), `/admin${path} has a date range filter`)
    if (path === '/cash-sales') assert.ok(html.includes('Cash in Hand') && html.includes('Individual Cash Entries'))
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
  assert.ok(adminToday.includes('Delete This Report'))
  assert.ok(adminToday.includes('Submitted by') && adminToday.includes('<dd>User<small>user</small>'), 'current summary identifies its submitter')
  assert.ok(adminToday.includes('Yesterday’s Cash in Hand') && adminToday.includes(taka(150)), 'admin summary includes yesterday’s closing cash')
  const rawSettings = await (await fetch(`${appUrl}/admin/settings`, { headers: adminHeaders })).text()
  const settings = htmlOnly(rawSettings)
  assert.ok(settings.includes('Change My Password') && settings.includes('Change User Password'))
  assert.ok(settings.includes('Entry Editing') && settings.includes('Change User Name'))
  assert.ok(settings.includes('Download report'))
  assert.ok(settings.includes('name="current_password"') && settings.includes('name="confirm_password"') && settings.includes('name="user_id"'))
  const accountOptions = settings.match(/<select name="user_id"[\s\S]*?<\/select>/)?.[0]
  assert.ok(accountOptions.includes(userId) && accountOptions.includes(secondUserId) && !accountOptions.includes(adminId), 'only user accounts can be selected for resets')
  assert.ok(!rawSettings.includes(fixtureSecret), 'server credentials never appear in settings HTML or client props')
  const settingsFooter = settings.match(/<div class="sidebar-footer">([\s\S]*?)<\/div>/)?.[1]
  assert.ok(settingsFooter.includes('/admin/settings') && settingsFooter.indexOf('Settings') < settingsFooter.indexOf('Logout'), 'Settings sits directly above Logout')
  const blockedSettings = await fetch(`${appUrl}/admin/settings`, { headers, redirect: 'manual' })
  const blockedSettingsBody = await blockedSettings.text()
  assert.ok(blockedSettings.headers.get('location') === '/dashboard' || blockedSettingsBody.includes('url=/dashboard'))
  console.log('PASS admin settings: password forms, user-only choices, Settings above Logout, private credentials and role protection')
  const adminPast = htmlOnly(await (await fetch(`${appUrl}/admin/summary?date=${previousDate}`, { headers: adminHeaders })).text())
  assert.ok(adminPast.includes('<dd>Second User<small>user2</small>'), 'a different date shows that report’s actual submitter')
  assert.ok(adminPast.includes('1 shared entries') && adminPast.includes('৳200.00'))
  assert.ok(adminPast.includes(taka(0)) && adminPast.includes('Yesterday’s Cash in Hand'), 'the first report starts with zero prior cash')
  const pastTables = [...adminPast.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)]
  assert.ok(!pastTables.at(-1)[1].includes('Alice'), 'date-selected summary excludes other days')
  console.log('PASS admin summary: today and date-selected submitted records')
  const downloadPath = `/admin/reports/download?from=${yesterday}&to=${today}`
  for (const actorHeaders of [headers, headersFor(secondUserId)]) {
    const forbidden = await fetch(appUrl + downloadPath, { headers: actorHeaders })
    assert.equal(forbidden.status, 403, 'ordinary users cannot download admin reports')
  }
  assert.equal((await fetch(appUrl + downloadPath, { redirect: 'manual' })).status, 401, 'downloads require a signed-in account')
  for (const suffix of ['', `?from=${today}&to=2020-01-01`, `?from=2026-02-30&to=${today}`, `?from=${today}&to=2999-01-01`]) {
    assert.equal((await fetch(appUrl + '/admin/reports/download' + suffix, { headers: adminHeaders })).status, 400, 'invalid export dates are rejected')
  }
  async function downloadRows(from, to) {
    const response = await fetch(`${appUrl}/admin/reports/download?${new URLSearchParams({ from, to })}`, { headers: adminHeaders })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert.ok(response.headers.get('content-disposition').includes(`ozi-pharma-report-${from}-to-${to}.xlsx`))
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    return readSheet(Buffer.from(await response.arrayBuffer()))
  }
  const exported = await downloadRows(yesterday, today)
  assert.equal(exported.length, 3)
  assert.deepEqual(exported.slice(1).map((row) => row[1]), [150, 250], 'download includes balances carried from dates before the selected range')
  assert.deepEqual(exported[1].slice(2), [100, 0, 0, 0, 150, 0, 0, 0], 'supplier payments stay separate from purchases')
  report.status = 'draft'
  const draftExport = await downloadRows(today, today)
  assert.deepEqual(draftExport[1].slice(1), [150, null, null, null, null, null, null, null, null], 'draft entries are omitted while cash carries forward')
  report.status = 'submitted'
  console.log('PASS Excel download: admin-only, validated inclusive dates, numeric daily totals, supplier columns, carried balances and draft exclusion')
  if (process.env.CASH_TOOL_BROWSER) {
    const { checkMobileLayout } = await import('./check-mobile-layout.mjs')
    browserEditingChanges = (await checkMobileLayout({ appUrl, adminHeaders, userHeaders: headers })).editingModeChanges
  }
  for (const actorHeaders of [headers, adminHeaders]) {
    for (const path of ['/cash-sales', '/credit-recovery', '/supplier', '/local-supplier', '/overhead-cost', '/conveyance']) {
      const prefix = actorHeaders === adminHeaders ? '/admin' : ''
      const html = htmlOnly(await (await fetch(`${appUrl}${prefix}${path}?from=${today}&to=${today}`, { headers: actorHeaders })).text())
      const bodies = [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map((match) => match[1]).join('')
      assert.ok(!bodies.includes(formatDate(previousDate)) && !bodies.includes('Previous daily total'), `${prefix}${path} excludes dates outside the range`)
    }
  }
  const rangedCash = htmlOnly(await (await fetch(`${appUrl}/admin/cash-sales?from=${today}&to=${today}`, { headers: adminHeaders })).text())
  const cashBody = rangedCash.match(/<tbody>([\s\S]*?)<\/tbody>/)[1]
  assert.ok(cashBody.includes(taka(250)), 'range retains cash carried from previous reports')
  cashSchemaAvailable = false
  const fallbackRange = htmlOnly(await (await fetch(`${appUrl}/cash-sales?from=${yesterday}&to=${yesterday}`, { headers })).text())
  assert.ok(fallbackRange.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].includes(taka(150)))
  cashSchemaAvailable = true
  const invalidRange = htmlOnly(await (await fetch(`${appUrl}/supplier?from=${today}&to=${previousDate}`, { headers })).text())
  assert.ok(invalidRange.includes('Date From must be on or before Date To.'))
  console.log('PASS all user/admin history ranges: matching rows, carried cash, legacy fallback and invalid range feedback')
  historySchema = 'previous'
  for (const actorHeaders of [headers, adminHeaders]) {
    const prefix = actorHeaders === adminHeaders ? '/admin' : ''
    for (const path of ['/credit-recovery', '/supplier', '/local-supplier', '/overhead-cost', '/conveyance']) {
      for (const suffix of ['', `?from=${today}&to=${today}`, `?from=${previousDate}&to=${today}`]) {
        const html = htmlOnly(await (await fetch(`${appUrl}${prefix}${path}${suffix}`, { headers: actorHeaders })).text())
        assert.ok(html.includes('Total for all matching entries') && html.includes('<tbody>'), `${prefix}${path} works with the previous RPC: ${suffix}`)
        assert.ok(!html.includes('Something went wrong'), `${prefix}${path} has no error screen`)
      }
    }
  }
  const oldPartyFilter = htmlOnly(await (await fetch(`${appUrl}/credit-recovery?party=1&from=${previousDate}&to=${today}`, { headers })).text())
  const oldPartyRows = oldPartyFilter.match(/<tbody>([\s\S]*?)<\/tbody>/)[1]
  const oldPartyTotals = oldPartyFilter.match(/<tfoot>([\s\S]*?)<\/tfoot>/)[1]
  assert.ok(oldPartyRows.includes('Alice') && !oldPartyRows.includes('Bob'))
  assert.ok(oldPartyTotals.includes(taka(100)) && oldPartyTotals.includes(taka(0)))
  const previousEntries = datasets.entry_history
  historySchema = 'missing'
  historyRowLimit = 200
  datasets.entry_history = Array.from({ length: 1005 }, (_, index) => ({
    ...base, id: 10000 + index, source: 'transaction', category: 'cash_purchase',
    business_date: previousDate, entry_type: 'cash_purchase', amount: 1,
  }))
  for (const actorHeaders of [headers, adminHeaders]) {
    const prefix = actorHeaders === adminHeaders ? '/admin' : ''
    const html = htmlOnly(await (await fetch(`${appUrl}${prefix}/local-supplier?from=${previousDate}&to=${today}&page=21`, { headers: actorHeaders })).text())
    assert.ok(html.includes('Page 21 of 21'))
    assert.equal([...html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].matchAll(/<tr>/g)].length, 5)
    assert.ok(html.match(/<tfoot>([\s\S]*?)<\/tfoot>/)[1].includes(taka(1005)), 'fallback totals include rows beyond the API limit')
    assert.ok(html.includes(`from=${previousDate}&amp;to=${today}`), 'fallback pagination preserves the date range')
  }
  datasets.entry_history = previousEntries
  historyRowLimit = Infinity
  historySchema = 'current'
  console.log('PASS history compatibility: all five user/admin pages load with the old RPC, name/date filters work, and totals cover capped API responses')
  const entryDashboard = htmlOnly(await (await fetch(`${appUrl}/admin/dashboard`, { headers: adminHeaders })).text())
  assert.ok(entryDashboard.includes('Save Report Entries') && entryDashboard.includes('name="amount"') && entryDashboard.includes('Add missed entries'))
  assert.ok(!entryDashboard.includes('entry-shortcuts'), 'admin dashboard shortcuts are removed')
  const earlierDashboard = htmlOnly(await (await fetch(`${appUrl}/admin/dashboard?date=${previousDate}`, { headers: adminHeaders })).text())
  assert.ok(earlierDashboard.includes(formatDate(previousDate, true)) && earlierDashboard.includes('name="amount"'))
  const blockedDashboard = await fetch(`${appUrl}/admin/dashboard`, { headers, redirect: 'manual' })
  const blockedBody = await blockedDashboard.text()
  assert.ok(blockedDashboard.headers.get('location') === '/dashboard' || blockedBody.includes('url=/dashboard'))
  console.log('PASS admin dashboard: current/submitted/past-day entry forms and user exclusion')
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
  const savedSummaries = datasets.admin_report_summary
  datasets.admin_report_summary = longHistory.map((row) => ({ ...savedSummaries[1], id: row.id, business_date: row.business_date, cash_sales: 10 }))
  exportRowLimit = 200
  const largeExport = await downloadRows(longHistory[0].business_date, longHistory.at(-1).business_date)
  assert.equal(largeExport.length, 1006, 'download includes every report beyond the Supabase response cap')
  assert.equal(largeExport.at(-1)[1], 1005)
  assert.equal(largeExport.at(-1)[2], 10)
  datasets.admin_report_summary = savedSummaries
  exportRowLimit = Infinity
  console.log('PASS large Excel download: 1,005 reports across capped responses with the legacy cash-balance fallback')
  datasets.daily_reports = savedReports
  cashSchemaAvailable = true
  console.log('PASS existing database pagination: balances include reports beyond the API row limit')
  assert.deepEqual(writes, [], 'history GET requests do not mutate data')
  assert.deepEqual(additions, [], 'read-only page checks do not add records')
  assert.deepEqual(adminBatches, [], 'read-only page checks do not save batches')
  assert.deepEqual(userBatches, [], 'read-only page checks do not submit reports')
  assert.deepEqual(partyAdditions, [], 'read-only page checks do not add dashboard names')
  assert.deepEqual(deletions, [], 'viewing summaries never deletes reports')
  assert.deepEqual(passwordChanges, [], 'viewing settings never changes passwords')
  assert.deepEqual(profileUpdates, browserEditingChanges.map(value => ({ id: adminId, values: { entry_editing_enabled: value } })), 'browser writes only the explicitly tested edit-mode changes')
  const manifest = JSON.parse(await readFile(new URL('../.next-page-check/dev/server/server-reference-manifest.json', import.meta.url), 'utf8'))
  async function invokeAction(name, values, actorHeaders, path) {
    const id = Object.entries(manifest.node).find(([, action]) => action.exportedName === name)?.[0]
    assert.ok(id, `${name} has a compiled server action`)
    const form = new FormData()
    for (const [key, value] of Object.entries(values)) form.set(key, value)
    const body = await encodeReply([null, form])
    const response = await fetch(appUrl + path, { method: 'POST', headers: { ...actorHeaders, 'Next-Action': id, origin: appUrl }, body, redirect: 'manual' })
    return { response, body: await response.text() }
  }
  async function saveBatch(values, actorHeaders = adminHeaders) {
    return invokeAction('adminSaveReportEntriesAction', values, actorHeaders, '/admin/dashboard')
  }
  const staged = JSON.stringify([{ kind: 'cash', amount: 35 }, { kind: 'transaction', category: 'conveyance', amount: 5 }])
  const savedBatch = await saveBatch({ confirm: 'yes', business_date: previousDate, staged_entries: staged })
  assert.ok(savedBatch.body.includes('Entries saved to the selected report.'))
  assert.equal(adminBatches[0].p_business_date, previousDate)
  assert.equal(adminBatches[0].p_entries.length, 2)
  assert.equal(previousReport.status, 'submitted')
  const beforeRejected = adminBatches.length
  const emptyBatch = await saveBatch({ confirm: 'yes', business_date: previousDate, staged_entries: '[]' })
  assert.ok(emptyBatch.body.includes('Add between 1 and 500 entries'))
  await saveBatch({ confirm: 'yes', business_date: previousDate, staged_entries: staged }, headers)
  assert.equal(adminBatches.length, beforeRejected, 'invalid and user batches do not reach the admin write RPC')
  console.log('PASS admin batch server action: selected date, complete payload, invalid input and role protection')
  async function submitAddition(values, actorHeaders = adminHeaders) {
    return invokeAction('adminAddHistoryRecordAction', values, actorHeaders, '/admin/credit-recovery')
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
  for (const [name, kind, table, actorHeaders, actorId, path] of [
    ['addCustomerAction', 'customer', 'customers', headers, userId, '/dashboard'],
    ['addSupplierAction', 'supplier', 'suppliers', adminHeaders, adminId, '/admin/dashboard'],
  ]) {
    const values = { name: `  Dashboard ${kind}  `, phone_number: ' 01700000001 ', notes: ' Saved contact note ' }
    const result = await invokeAction(name, values, actorHeaders, path)
    assert.ok(result.body.includes(`Dashboard ${kind} added.`) && result.body.includes(`"${kind}":`), 'the form receives its added record under the expected key')
    const saved = partyAdditions.at(-1)
    assert.equal(saved.table, table)
    assert.equal(saved.created_by, actorId)
    assert.equal(saved.name, `Dashboard ${kind}`)
    assert.equal(saved.phone_number, '01700000001')
    assert.equal(saved.notes, 'Saved contact note')
    assert.equal(saved.opening_due, 0)
    const duplicate = await invokeAction(name, values, actorHeaders, path)
    assert.ok(duplicate.body.includes('already exists.'))
    const count = partyAdditions.length
    const blank = await invokeAction(name, { name: ' ' }, actorHeaders, path)
    assert.ok(blank.body.includes('Enter the'))
    assert.equal(partyAdditions.length, count, 'blank names do not reach the database')
  }
  console.log('PASS shared dashboard name actions: user/admin authorship, contacts, return keys, duplicates and blank names')
  report.status = 'draft'
  for (const entries of [staged, '[]']) {
    const result = await invokeAction('submitReportAction', { confirm: 'yes', staged_entries: entries, business_date: previousDate }, headers, '/dashboard')
    assert.ok(result.body.includes('report submitted successfully.'))
    assert.equal(userBatches.at(-1).p_business_date, today, 'users submit only the current business date')
    assert.deepEqual(userBatches.at(-1).p_entries, JSON.parse(entries))
  }
  for (const [name, actorHeaders, path, records] of [
    ['submitReportAction', headers, '/dashboard', userBatches],
    ['adminSaveReportEntriesAction', adminHeaders, '/admin/dashboard', adminBatches],
  ]) {
    const count = records.length
    for (const invalid of ['{', '{}', JSON.stringify(Array(501).fill({ kind: 'cash', amount: 1 })), ' '.repeat(250001)]) {
      const result = await invokeAction(name, { confirm: 'yes', business_date: today, staged_entries: invalid }, actorHeaders, path)
      assert.ok(result.body.includes('could not be read') || result.body.includes('invalid') || result.body.includes('between 1 and 500') || result.body.includes('too many entries'))
    }
    await invokeAction(name, { business_date: today, staged_entries: staged }, actorHeaders, path)
    assert.equal(records.length, count, 'invalid or unconfirmed batches never reach either save RPC')
  }
  await invokeAction('submitReportAction', { confirm: 'yes', staged_entries: staged }, adminHeaders, '/dashboard')
  assert.equal(userBatches.length, 2, 'admin cannot invoke the user submission action')
  console.log('PASS shared submission validation: current-date user submissions, empty-user batches, malformed/oversized input, confirmation and role checks')
  const ownValues = { current_password: 'LocalAdminOld12!', new_password: 'LocalAdminNew12!', confirm_password: 'LocalAdminNew12!', user_id: userId }
  const wrongPassword = await invokeAction('changeOwnPasswordAction', { ...ownValues, current_password: 'WrongLocalPassword12!' }, adminHeaders, '/admin/settings')
  assert.ok(wrongPassword.body.includes('current password could not be verified'))
  assert.equal(passwordChanges.length, 0)
  const ownChanged = await invokeAction('changeOwnPasswordAction', ownValues, adminHeaders, '/admin/settings')
  assert.ok(ownChanged.body.includes('Your password has been changed.'))
  assert.deepEqual(passwordChanges[0], { id: adminId, password: ownValues.new_password, admin: false }, 'own password changes use the verified session identity')
  assert.ok(!ownChanged.body.includes(ownValues.new_password), 'passwords never appear in the action response')
  const resetValues = { user_id: userId, new_password: 'LocalUserNew12!', confirm_password: 'LocalUserNew12!' }
  const userChanged = await invokeAction('changeUserPasswordAction', resetValues, adminHeaders, '/admin/settings')
  assert.ok(userChanged.body.includes('password has been changed.'))
  assert.deepEqual(passwordChanges[1], { id: userId, password: resetValues.new_password, admin: true })
  assert.ok(!userChanged.body.includes(resetValues.new_password))
  for (const action of ['changeOwnPasswordAction', 'changeUserPasswordAction']) {
    for (const values of [
      { ...resetValues, ...ownValues, new_password: 'short', confirm_password: 'short' },
      { ...resetValues, ...ownValues, confirm_password: 'DifferentPassword12!' },
      { ...resetValues, ...ownValues, new_password: 'p'.repeat(73), confirm_password: 'p'.repeat(73) },
    ]) {
      const invalid = await invokeAction(action, values, adminHeaders, '/admin/settings')
      assert.ok(invalid.body.includes('Use at least 12') || invalid.body.includes('do not match'))
    }
    await invokeAction(action, { ...resetValues, ...ownValues }, headers, '/admin/settings')
  }
  for (const user_id of [adminId, '00000000-0000-0000-0000-000000000000', 'not-a-user-id']) {
    const rejected = await invokeAction('changeUserPasswordAction', { ...resetValues, user_id }, adminHeaders, '/admin/settings')
    assert.ok(rejected.body.includes('Select a'))
  }
  passwordErrorCode = 'weak_password'
  const weakPassword = await invokeAction('changeOwnPasswordAction', { ...ownValues, current_password: ownValues.new_password, new_password: 'OtherPassword12!', confirm_password: 'OtherPassword12!' }, adminHeaders, '/admin/settings')
  assert.ok(weakPassword.body.includes('Choose a stronger password'))
  passwordErrorCode = null
  assert.equal(passwordChanges.length, 2, 'invalid inputs, wrong targets and user actors never update credentials')
  console.log('PASS password server actions: current-password verification, self identity, privileged user reset, validation, safe errors, private responses and role checks')
  const deleteValues = { report_id: String(previousReport.id), business_date: previousDate, confirm: 'yes', confirm_date: previousDate }
  for (const values of [
    { ...deleteValues, confirm: 'no' }, { ...deleteValues, confirm_date: today },
    { ...deleteValues, report_id: 'invalid' }, { ...deleteValues, business_date: 'invalid' },
  ]) await invokeAction('adminDeleteReportAction', values, adminHeaders, '/admin/summary')
  await invokeAction('adminDeleteReportAction', deleteValues, headers, '/admin/summary')
  assert.equal(deletions.length, 0, 'invalid, unconfirmed and user deletions never reach the RPC')
  const deleted = await invokeAction('adminDeleteReportAction', deleteValues, adminHeaders, '/admin/summary')
  assert.ok(deleted.body.includes(`all entries for ${previousDate} have been deleted.`))
  assert.deepEqual(deletions, [{ p_report_id: previousReport.id, p_business_date: previousDate }])
  const afterDelete = htmlOnly(await (await fetch(`${appUrl}/admin/summary?date=${previousDate}`, { headers: adminHeaders })).text())
  assert.ok(afterDelete.includes('No submitted report for this date.') && !afterDelete.includes('Delete This Report'))
  assert.ok(datasets.daily_reports.some((row) => row.id === report.id), 'deleting one date preserves the current report')
  console.log('PASS report deletion action: date/id scope, typed confirmation, permissions and the empty summary after deletion')
  for (const [value, expected] of [['false', false], ['true', true], ['false', false]]) {
    const result = await invokeAction('setEntryEditingAction', { enabled: value, user_id: userId }, adminHeaders, '/admin/settings')
    assert.ok(result.body.includes(`Entry editing is ${expected ? 'on' : 'off'}.`))
    assert.equal(adminProfile.entry_editing_enabled, expected)
    assert.equal(profile.entry_editing_enabled, false, 'the setting always targets the signed-in admin')
    for (const path of ['/cash-sales', '/credit-recovery', '/supplier', '/local-supplier', '/overhead-cost', '/conveyance']) {
      const html = htmlOnly(await (await fetch(`${appUrl}/admin${path}`, { headers: adminHeaders })).text())
      assert.equal(html.includes('table-edit'), expected, `${path} follows saved edit mode`)
    }
  }
  const editValues = { source: 'cash', id: '1', amount: '77' }
  const lockedEdit = await invokeAction('adminEditEntryAction', editValues, adminHeaders, '/admin/cash-sales')
  assert.ok(lockedEdit.body.includes('Enable entry editing in Settings'))
  assert.equal(entryEdits.length, 0)
  await invokeAction('setEntryEditingAction', { enabled: 'true' }, adminHeaders, '/admin/settings')
  const allowedEdit = await invokeAction('adminEditEntryAction', editValues, adminHeaders, '/admin/cash-sales')
  assert.ok(allowedEdit.body.includes('Entry updated.'))
  assert.equal(entryEdits.length, 1)
  const beforeInvalidPreferences = profileUpdates.length
  await invokeAction('setEntryEditingAction', { enabled: 'invalid' }, adminHeaders, '/admin/settings')
  await invokeAction('setEntryEditingAction', { enabled: 'true' }, headers, '/admin/settings')
  assert.equal(profileUpdates.length, beforeInvalidPreferences, 'invalid settings and users never update edit mode')
  console.log('PASS entry-editing setting: persistent on/off controls, all admin tables, server-side enforcement and user exclusion')
  const rename = await invokeAction('renameUserAction', { user_id: userId, full_name: '  Rafiq Hasan  ', role: 'superadmin', username: 'changed' }, adminHeaders, '/admin/settings')
  assert.ok(rename.body.includes('Rafiq Hasan saved.'))
  assert.equal(profile.full_name, 'Rafiq Hasan')
  assert.equal(profile.username, 'user')
  assert.equal(profile.role, 'user')
  report.status = 'submitted'
  const renamedSummary = htmlOnly(await (await fetch(`${appUrl}/admin/summary`, { headers: adminHeaders })).text())
  assert.ok(renamedSummary.includes('<dd>Rafiq Hasan<small>user</small>'), 'summary attribution follows the renamed user')
  const renamedUsers = htmlOnly(await (await fetch(`${appUrl}/admin/users`, { headers: adminHeaders })).text())
  const renamedDashboard = htmlOnly(await (await fetch(`${appUrl}/dashboard`, { headers })).text())
  assert.ok(renamedUsers.includes('Rafiq Hasan') && renamedDashboard.includes('Rafiq Hasan'), 'user lists and the signed-in header use the new name')
  const beforeInvalidNames = profileUpdates.length
  for (const values of [
    { user_id: userId, full_name: ' ' }, { user_id: userId, full_name: 'n'.repeat(151) },
    { user_id: adminId, full_name: 'Other Admin' }, { user_id: 'not-a-user', full_name: 'Invalid' },
  ]) await invokeAction('renameUserAction', values, adminHeaders, '/admin/settings')
  await invokeAction('renameUserAction', { user_id: userId, full_name: 'Unauthorized' }, headers, '/admin/settings')
  assert.equal(profileUpdates.length, beforeInvalidNames, 'invalid names and unauthorized accounts do not change profiles')
  console.log('PASS user names: admin-only display-name changes update attribution and headers without changing login usernames or roles')
} catch (error) {
  console.error(logs.slice(-5000))
  throw error
} finally {
  child.kill()
  backend.closeAllConnections()
  backend.close()
}
