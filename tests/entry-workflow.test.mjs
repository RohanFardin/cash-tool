import { after, afterEach, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const operator = '11111111-1111-4111-8111-111111111111'
const admin = '22222222-2222-4222-8222-222222222222'
const secondOperator = '33333333-3333-4333-8333-333333333333'
const db = new PGlite()
let todayId
let yesterdayId
let customerId
let supplierId
let overheadId

async function actor(id) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
}

async function cash(amount, report = todayId) {
  return db.query('insert into public.cash_sales_entries (daily_report_id, amount, created_by) values ($1, $2, $3) returning *', [report, amount, operator])
}

async function credit(type, amount, party = customerId, phone = null, description = null) {
  return db.query('insert into public.customer_ledger_entries (daily_report_id, customer_id, entry_type, amount, created_by, updated_by, phone_number, description) values ($1,$2,$3,$4,$5,$5,$6,$7) returning *', [todayId, party, type, amount, operator, phone, description])
}

async function supplier(type, amount, phone = null, description = null) {
  return db.query('insert into public.supplier_ledger_entries (daily_report_id, supplier_id, entry_type, amount, created_by, updated_by, phone_number, description) values ($1,$2,$3,$4,$5,$5,$6,$7) returning *', [todayId, supplierId, type, amount, operator, phone, description])
}

async function expense(category, amount) {
  return db.query('insert into public.transactions (daily_report_id, category, name, amount, created_by, updated_by, overhead_category_id) values ($1,$2,$2,$3,$4,$4,$5) returning *', [todayId, category, amount, operator, category === 'overhead' ? overheadId : null])
}

async function submit() {
  await db.query("update public.daily_reports set status = 'submitted' where id = $1", [todayId])
}

async function total() {
  const result = await db.query('select cash_sales from public.daily_reports where id = $1', [todayId])
  return Number(result.rows[0].cash_sales)
}

before(async () => {
  // Minimal Supabase Auth scaffolding. All application tables, views, policies,
  // functions and triggers come from the actual production migrations.
  await db.exec(`
    create role authenticated nologin;
    create role anon nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `)
  const directory = new URL('../supabase/migrations/', import.meta.url)
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    if (file.startsWith('003')) {
      await db.query('insert into auth.users (id,email) values ($1,$2),($3,$4)', [operator, 'user@pharmacy.local', admin, 'admin@pharmacy.local'])
      await db.query('insert into auth.users (id,email) values ($1,$2)', [secondOperator, 'user2@pharmacy.local'])
      await db.query("update public.profiles set role = 'superadmin' where id = $1", [admin])
      const oldReport = await db.query("insert into public.daily_reports (business_date,cash_sales,submitted_by,status) values (public.current_business_date()-1,400,$1,'submitted') returning id", [operator])
      yesterdayId = oldReport.rows[0].id
      await db.query("insert into public.transactions (daily_report_id,category,transaction_subtype,name,amount,created_by) values ($1,'credit','credit_sale','Alice',75,$2)", [yesterdayId, operator])
    }
    try {
      await db.exec(await readFile(new URL(file, directory), 'utf8'))
    } catch (error) {
      throw new Error(`${file}: ${error.message}`)
    }
  }
  await actor(admin)
  customerId = (await db.query("insert into public.customers (name,created_by) values ('Alice',$1) returning id", [admin])).rows[0].id
  supplierId = (await db.query("insert into public.suppliers (name,created_by) values ('Medicine Company',$1) returning id", [admin])).rows[0].id
  overheadId = (await db.query("insert into public.overhead_categories (name,created_by) values ('Rent',$1) returning id", [admin])).rows[0].id
  await actor(operator)
  todayId = (await db.query("insert into public.daily_reports (business_date,submitted_by) values (public.current_business_date(),$1) returning id", [operator])).rows[0].id
})

beforeEach(async () => {
  await db.exec('begin; set local role authenticated;')
  await actor(operator)
})
afterEach(async () => { await db.exec('rollback;') })
after(async () => { await db.close() })

test('cash entries accumulate without overwriting and use database timestamps', async () => {
  const first = (await cash(100.25)).rows[0]
  const second = (await cash(250.25)).rows[0]
  assert.notEqual(first.id, second.id)
  assert.ok(first.created_at instanceof Date)
  assert.equal(await total(), 350.5)
  const history = await db.query("select * from public.entry_history where category='cash_sales' and business_date=public.current_business_date()")
  assert.equal(history.rows.length, 2)
  assert.equal(Number(history.rows[0].amount) + Number(history.rows[1].amount), 350.5)
})

test('old cash totals and credit transactions remain visible in history', async () => {
  const oldCash = await db.query("select * from public.entry_history where category='cash_sales' and business_date=public.current_business_date()-1")
  assert.equal(oldCash.rows.length, 1)
  assert.equal(oldCash.rows[0].entry_type, 'previous_total')
  assert.equal(Number(oldCash.rows[0].amount), 400)
  const oldCredit = await db.query("select * from public.entry_history where category='credit' and business_date=public.current_business_date()-1")
  assert.equal(oldCredit.rows[0].party_name, 'Alice')
  assert.equal(Number(oldCredit.rows[0].party_id), Number(customerId))
})

test('operators cannot update or delete saved entries, even in a draft report', async () => {
  const rows = [
    ['cash_sales_entries', (await cash(100)).rows[0]],
    ['customer_ledger_entries', (await credit('credit_sale', 200)).rows[0]],
    ['supplier_ledger_entries', (await supplier('purchase', 300)).rows[0]],
    ['transactions', (await expense('conveyance', 20)).rows[0]],
  ]
  for (const [table, row] of rows) {
    assert.equal((await db.query(`update public.${table} set amount=1 where id=$1 returning id`, [row.id])).rows.length, 0)
    assert.equal((await db.query(`delete from public.${table} where id=$1 returning id`, [row.id])).rows.length, 0)
    const saved = (await db.query(`select amount from public.${table} where id=$1`, [row.id])).rows[0]
    assert.equal(Number(saved.amount), Number(row.amount))
  }
})

test('submission records its timestamp and closes every entry category', async () => {
  await cash(100)
  await submit()
  const report = (await db.query('select * from public.daily_reports where id=$1', [todayId])).rows[0]
  assert.equal(report.status, 'submitted')
  assert.ok(report.submitted_at instanceof Date)
  // Savepoints keep the transaction usable after each expected SQL rejection.
  for (const insert of [() => cash(10), () => credit('credit_sale', 10), () => supplier('payment', 10), () => expense('cash_purchase', 10), () => expense('overhead', 10), () => expense('conveyance', 10)]) {
    await db.exec('savepoint expected_failure')
    await assert.rejects(insert)
    await db.exec('rollback to savepoint expected_failure')
  }
  assert.equal(await total(), 100)
  assert.equal((await db.query("update public.daily_reports set status='draft' where id=$1 returning id", [todayId])).rows.length, 0)
})

test('operators cannot overwrite cash totals directly or use administrator RPCs', async () => {
  await assert.rejects(db.query('update public.daily_reports set cash_sales=999 where id=$1', [todayId]), /individual entries/)
})

test('administrator RPC is unavailable to operators', async () => {
  await assert.rejects(db.query("select public.admin_update_daily_report($1,100,'draft',null)", [todayId]), /Administrator access required/)
})

test('past days are read-only for operators', async () => {
  await assert.rejects(cash(10, yesterdayId))
})

test('a new business day starts empty while prior entries stay in history', async () => {
  await cash(100)
  await submit()
  await db.exec(`
    reset role;
    create or replace function public.current_business_date() returns date
    language sql stable set search_path=pg_catalog as
      $$ select (now() at time zone 'Asia/Dhaka')::date + 1 $$;
    set local role authenticated;
  `)
  const today = await db.query('select * from public.daily_reports where business_date=public.current_business_date()')
  assert.equal(today.rows.length, 0)
  const history = await db.query("select * from public.entry_history where category='cash_sales'")
  assert.equal(history.rows.length, 2)
  const nextDay = await db.query('insert into public.daily_reports (business_date,submitted_by) values (public.current_business_date(),$1) returning cash_sales', [operator])
  assert.equal(Number(nextDay.rows[0].cash_sales), 0)
})

test('credit name filters and totals include complete history beyond one page', async () => {
  for (let index = 0; index < 55; index += 1) await credit('credit_sale', 10)
  await credit('credit_recovery', 100)
  const summary = (await db.query("select * from public.entry_history_totals('credit',$1)", [customerId])).rows[0]
  assert.equal(Number(summary.entry_count), 57) // 55 sales, one recovery, one legacy sale
  assert.equal(Number(summary.primary_total), 625)
  assert.equal(Number(summary.secondary_total), 100)
  const other = (await db.query("select * from public.entry_history_totals('credit',999999)")).rows[0]
  assert.equal(Number(other.entry_count), 0)
  assert.equal(Number(other.primary_total), 0)
})

test('supplier history separates purchases from payments', async () => {
  await supplier('purchase', 900)
  await supplier('payment', 350)
  const summary = (await db.query("select * from public.entry_history_totals('supplier',$1)", [supplierId])).rows[0]
  assert.equal(Number(summary.primary_total), 900)
  assert.equal(Number(summary.secondary_total), 350)
})

test('contact numbers and notes remain visible in customer and supplier history', async () => {
  await credit('credit_recovery', 125, customerId, '01700111222', 'Paid at counter')
  await supplier('payment', 225, '01800999888', 'Invoice 42')
  const customer = (await db.query("select * from public.entry_history where category='credit' and phone_number is not null")).rows[0]
  const company = (await db.query("select * from public.entry_history where category='supplier' and phone_number is not null")).rows[0]
  assert.equal(customer.phone_number, '01700111222')
  assert.equal(customer.description, 'Paid at counter')
  assert.equal(company.phone_number, '01800999888')
  assert.equal(company.description, 'Invoice 42')
})

test('cash in hand is null in draft and stored from the requested formula on submission', async () => {
  await cash(1000)
  await credit('credit_sale', 200)
  await credit('credit_recovery', 150)
  await supplier('purchase', 500)
  await supplier('payment', 100)
  await expense('cash_purchase', 75)
  await expense('overhead', 25)
  await expense('conveyance', 10)
  assert.equal((await db.query('select cash_in_hand from public.daily_reports where id=$1', [todayId])).rows[0].cash_in_hand, null)
  await submit()
  const saved = (await db.query('select cash_in_hand from public.daily_reports where id=$1', [todayId])).rows[0]
  assert.equal(Number(saved.cash_in_hand), 940)
})

test('staged submission saves every category atomically and then locks the report', async () => {
  const staged = [
    { kind: 'cash', amount: 1000 },
    { kind: 'customer', party_id: customerId, entry_type: 'credit_sale', amount: 200, phone_number: '01710000000', description: 'Due note' },
    { kind: 'customer', party_id: customerId, entry_type: 'credit_recovery', amount: 150, phone_number: '01710000000', description: 'Recovery note' },
    { kind: 'supplier', party_id: supplierId, entry_type: 'purchase', amount: 500, phone_number: '01810000000', description: 'Purchase note' },
    { kind: 'supplier', party_id: supplierId, entry_type: 'payment', amount: 100, phone_number: '01810000000', description: 'Payment note' },
    { kind: 'transaction', category: 'cash_purchase', amount: 75 },
    { kind: 'transaction', category: 'overhead', overhead_category_id: overheadId, amount: 25 },
    { kind: 'transaction', category: 'conveyance', amount: 10 },
  ]
  await db.query('select public.submit_staged_report(public.current_business_date(),$1::jsonb)', [JSON.stringify(staged)])
  const report = (await db.query('select status, cash_sales, cash_in_hand from public.daily_reports where id=$1', [todayId])).rows[0]
  assert.equal(report.status, 'submitted')
  assert.equal(Number(report.cash_sales), 1000)
  assert.equal(Number(report.cash_in_hand), 940)
  assert.equal(Number((await db.query('select count(*) from public.entry_history where business_date=public.current_business_date()')).rows[0].count), 8)
  const customer = (await db.query("select phone_number, description from public.entry_history where category='credit' and entry_type='credit_recovery'")).rows[0]
  assert.deepEqual(customer, { phone_number: '01710000000', description: 'Recovery note' })
})

test('an invalid staged batch rolls back every entry and leaves the report open', async () => {
  const staged = [{ kind: 'cash', amount: 100 }, { kind: 'unknown', amount: 10 }]
  await db.exec('savepoint invalid_staged_batch')
  await assert.rejects(
    db.query('select public.submit_staged_report(public.current_business_date(),$1::jsonb)', [JSON.stringify(staged)]),
    /Invalid staged entry type/,
  )
  await db.exec('rollback to savepoint invalid_staged_batch')
  assert.equal(Number((await db.query('select count(*) from public.cash_sales_entries where daily_report_id=$1', [todayId])).rows[0].count), 0)
  assert.equal((await db.query('select status from public.daily_reports where id=$1', [todayId])).rows[0].status, 'draft')
})

test('storekeepers can add supplier companies with a phone number and notes', async () => {
  const company = (await db.query("insert into public.suppliers (name,phone_number,notes,opening_due,created_by) values ('New Company','01910000000','New supplier',0,$1) returning name,phone_number,notes", [operator])).rows[0]
  assert.deepEqual(company, { name: 'New Company', phone_number: '01910000000', notes: 'New supplier' })
})

test('local supplier, overhead and conveyance history retains each entry', async () => {
  for (const category of ['cash_purchase', 'overhead', 'conveyance']) {
    await expense(category, 25)
    await expense(category, 35)
    const summary = (await db.query('select * from public.entry_history_totals($1,null)', [category])).rows[0]
    assert.equal(Number(summary.entry_count), 2)
    assert.equal(Number(summary.primary_total), 60)
  }
})

test('administrator cash corrections preserve history and report totals', async () => {
  await cash(100)
  await submit()
  await actor(admin)
  await db.query("select public.admin_update_daily_report($1,80,'approved','Corrected')", [todayId])
  assert.equal(await total(), 80)
  const adjustment = (await db.query("select * from public.cash_sales_entries where daily_report_id=$1 and entry_type='adjustment'", [todayId])).rows[0]
  assert.equal(Number(adjustment.amount), -20)
  assert.equal(Number((await db.query('select cash_in_hand from public.daily_reports where id=$1', [todayId])).rows[0].cash_in_hand), 80)
  const summary = (await db.query("select * from public.entry_history_totals('cash_sales',null)")).rows[0]
  assert.equal(Number(summary.primary_total), 480) // previous day's 400 + corrected 80
})

test('anonymous users cannot read history', async () => {
  await db.exec('set local role anon')
  await assert.rejects(db.query('select * from public.entry_history'), /permission denied/)
})

test('both storekeepers share one daily report, history, totals and submission', async () => {
  await cash(100)
  await actor(secondOperator)
  await db.query('insert into public.cash_sales_entries (daily_report_id,amount,created_by) values ($1,200,$2)', [todayId, secondOperator])
  assert.equal(await total(), 300)
  const entries = await db.query('select created_by from public.cash_sales_entries where daily_report_id=$1 order by id', [todayId])
  assert.deepEqual(entries.rows.map((row) => row.created_by), [operator, secondOperator])
  assert.equal((await db.query('select id from public.daily_reports where business_date=public.current_business_date()')).rows.length, 1)
  await submit()
  await actor(operator)
  const report = (await db.query('select * from public.daily_reports where id=$1', [todayId])).rows[0]
  assert.equal(report.status, 'submitted')
  assert.equal(report.submitted_by, secondOperator)
  assert.equal(Number(report.cash_sales), 300)
  await assert.rejects(cash(10))
})

test('administrators can edit every submitted category in place', async () => {
  const records = [
    ['cash', 'cash_sales_entries', (await cash(100)).rows[0]],
    ['customer', 'customer_ledger_entries', (await credit('credit_sale', 200)).rows[0]],
    ['supplier', 'supplier_ledger_entries', (await supplier('purchase', 300)).rows[0]],
    ['transaction', 'transactions', (await expense('cash_purchase', 20)).rows[0]],
    ['transaction', 'transactions', (await expense('overhead', 30)).rows[0]],
    ['transaction', 'transactions', (await expense('conveyance', 40)).rows[0]],
  ]
  await submit()
  await actor(admin)
  for (const [source, table, entry] of records) {
    const partyId = source === 'customer' ? customerId : source === 'supplier' ? supplierId : null
    const type = source === 'customer' ? 'credit_recovery' : source === 'supplier' ? 'payment' : null
    const result = await db.query('select public.admin_edit_entry($1,$2,$3,$4,$5,$6,$7) as report_date', [source, entry.id, Number(entry.amount) + 10, partyId, type, entry.category === 'overhead' ? overheadId : null, 'Corrected'])
    assert.ok(result.rows[0].report_date)
    const saved = (await db.query(`select * from public.${table} where id=$1`, [entry.id])).rows[0]
    assert.equal(Number(saved.amount), Number(entry.amount) + 10)
    assert.equal(saved.created_at.toISOString(), entry.created_at.toISOString())
    assert.equal(saved.created_by, operator)
    assert.equal(saved.updated_by, admin)
    if (type) assert.equal(saved.entry_type, type)
  }
  assert.equal(await total(), 110)
  const cashCount = await db.query('select count(*) from public.cash_sales_entries where daily_report_id=$1', [todayId])
  assert.equal(Number(cashCount.rows[0].count), 1, 'individual edits do not create correction rows')
  const customerTotals = (await db.query("select * from public.entry_history_totals('credit',null,public.current_business_date())")).rows[0]
  assert.equal(Number(customerTotals.primary_total), 0)
  assert.equal(Number(customerTotals.secondary_total), 210)
  const editedReport = (await db.query('select status, cash_in_hand from public.daily_reports where id=$1', [todayId])).rows[0]
  assert.equal(editedReport.status, 'submitted')
  assert.equal(Number(editedReport.cash_in_hand), -110)
})

test('operators cannot call the administrator entry editor', async () => {
  const entry = (await cash(100)).rows[0]
  await assert.rejects(db.query("select public.admin_edit_entry('cash',$1,10)", [entry.id]), /Administrator access required/)
})

test('report-date totals include only the selected submitted day', async () => {
  await cash(100)
  await credit('credit_sale', 50)
  const current = (await db.query('select * from public.entry_history_totals(null,null,public.current_business_date())')).rows[0]
  assert.equal(Number(current.entry_count), 2)
  assert.equal(Number(current.primary_total), 150)
  const old = (await db.query('select * from public.entry_history_totals(null,null,public.current_business_date()-1)')).rows[0]
  assert.equal(Number(old.entry_count), 2)
  assert.equal(Number(old.primary_total), 475)
})

test('administrators can correct previous-day cash and legacy credit entries', async () => {
  await actor(admin)
  const oldCash = (await db.query('select * from public.cash_sales_entries where daily_report_id=$1', [yesterdayId])).rows[0]
  await db.query("select public.admin_edit_entry('cash',$1,350)", [oldCash.id])
  assert.equal(Number((await db.query('select cash_sales from public.daily_reports where id=$1', [yesterdayId])).rows[0].cash_sales), 350)
  const legacy = (await db.query("select id from public.transactions where daily_report_id=$1 and category='credit'", [yesterdayId])).rows[0]
  await db.query("select public.admin_edit_entry('transaction',$1,25,$2,'credit_recovery')", [legacy.id, customerId])
  const saved = (await db.query("select * from public.entry_history where source='transaction' and id=$1", [legacy.id])).rows[0]
  assert.equal(saved.entry_type, 'credit_recovery')
  assert.equal(Number(saved.amount), 25)
})
