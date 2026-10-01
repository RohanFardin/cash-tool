begin;

-- ---------------------------------------------------------------------------
-- Explicit application usernames (passwords remain exclusively in auth.users)
-- ---------------------------------------------------------------------------

alter table public.profiles add column username text;

update public.profiles p
set username = lower(split_part(u.email, '@', 1))
from auth.users u
where u.id = p.id;

alter table public.profiles
  alter column username set not null,
  add constraint profiles_username_format_check
    check (username ~ '^[a-z0-9._-]{2,40}$');

create unique index profiles_username_lower_uidx
  on public.profiles (lower(username));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  derived_name text;
  base_username text;
  derived_username text;
begin
  derived_name := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
  base_username := lower(coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
    split_part(coalesce(new.email, ''), '@', 1)
  ));
  base_username := regexp_replace(base_username, '[^a-z0-9._-]', '', 'g');
  if length(base_username) < 2 then
    base_username := 'user_' || left(replace(new.id::text, '-', ''), 8);
  end if;
  base_username := left(base_username, 40);
  derived_username := base_username;
  if exists (select 1 from public.profiles where lower(username) = lower(derived_username)) then
    derived_username := left(base_username, 31) || '_' || left(replace(new.id::text, '-', ''), 8);
  end if;

  insert into public.profiles (id, username, full_name, role)
  values (
    new.id,
    derived_username,
    coalesce(derived_name, derived_username),
    'user'
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared daily-report authorship and approval audit fields
-- ---------------------------------------------------------------------------

alter table public.daily_reports
  add column created_by uuid references public.profiles(id),
  add column last_edited_by uuid references public.profiles(id),
  add column cash_sales_updated_by uuid references public.profiles(id),
  add column submitted_at timestamptz,
  add column approved_by uuid references public.profiles(id),
  add column approved_at timestamptz;

update public.daily_reports
set
  created_by = submitted_by,
  last_edited_by = submitted_by,
  cash_sales_updated_by = submitted_by,
  submitted_at = case when status in ('submitted', 'approved') then updated_at else null end,
  approved_at = case when status = 'approved' then updated_at else null end;

alter table public.daily_reports alter column created_by set not null;

create index daily_reports_created_by_idx on public.daily_reports (created_by);
create index daily_reports_last_edited_by_idx on public.daily_reports (last_edited_by);
create index daily_reports_approved_by_idx on public.daily_reports (approved_by);

create or replace function public.audit_daily_report()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  actor uuid := (select auth.uid());
  actor_is_admin boolean := coalesce((select public.is_superadmin()), false);
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, actor);
    new.submitted_by := coalesce(new.submitted_by, actor);
    new.last_edited_by := coalesce(new.last_edited_by, actor);
    new.cash_sales_updated_by := coalesce(new.cash_sales_updated_by, actor);
    if new.status = 'submitted' then
      new.submitted_by := actor;
      new.submitted_at := now();
    elsif new.status = 'approved' then
      new.approved_by := actor;
      new.approved_at := now();
    end if;
    return new;
  end if;

  if actor is not null then
    new.last_edited_by := actor;
    if new.cash_sales is distinct from old.cash_sales then
      new.cash_sales_updated_by := actor;
    end if;
  end if;

  -- Original report ownership and business date are immutable for operators.
  if not actor_is_admin then
    new.created_by := old.created_by;
    new.business_date := old.business_date;
    if old.status <> 'draft' then
      raise exception 'Submitted reports are locked';
    end if;
    if new.status not in ('draft', 'submitted') then
      raise exception 'Only an administrator may approve reports';
    end if;
  end if;

  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    new.submitted_by := actor;
    new.submitted_at := now();
  end if;

  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_by := actor;
    new.approved_at := now();
  elsif new.status <> 'approved' then
    new.approved_by := null;
    new.approved_at := null;
  end if;

  return new;
end;
$$;

create trigger daily_reports_audit
before insert or update on public.daily_reports
for each row execute function public.audit_daily_report();

alter table public.transactions
  add column updated_by uuid references public.profiles(id);

update public.transactions set updated_by = created_by;
alter table public.transactions alter column updated_by set not null;
create index transactions_updated_by_idx on public.transactions (updated_by);

create or replace function public.audit_transaction()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, actor);
    new.updated_by := coalesce(new.updated_by, actor, new.created_by);
  else
    new.created_by := old.created_by;
    new.updated_by := coalesce(actor, old.updated_by);
  end if;
  return new;
end;
$$;

create trigger transactions_audit
before insert or update on public.transactions
for each row execute function public.audit_transaction();

-- ---------------------------------------------------------------------------
-- Customer receivables: opening due + credit sales - recoveries
-- ---------------------------------------------------------------------------

create table public.customers (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  opening_due numeric(14,2) not null default 0 check (opening_due >= 0),
  opening_balance_date date not null default public.current_business_date(),
  notes text,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index customers_name_lower_uidx on public.customers (lower(btrim(name)));
create index customers_created_by_idx on public.customers (created_by);

create table public.customer_ledger_entries (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.customers(id),
  daily_report_id bigint not null references public.daily_reports(id) on delete restrict,
  entry_type text not null check (entry_type in ('credit_sale', 'credit_recovery')),
  amount numeric(14,2) not null check (amount > 0),
  description text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customer_ledger_customer_idx
  on public.customer_ledger_entries (customer_id, created_at);
create index customer_ledger_report_idx
  on public.customer_ledger_entries (daily_report_id);
create index customer_ledger_type_idx
  on public.customer_ledger_entries (entry_type);
create index customer_ledger_created_by_idx
  on public.customer_ledger_entries (created_by);

-- ---------------------------------------------------------------------------
-- Supplier payables: opening due + purchases - payments
-- ---------------------------------------------------------------------------

create table public.suppliers (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  opening_due numeric(14,2) not null default 0 check (opening_due >= 0),
  opening_balance_date date not null default public.current_business_date(),
  notes text,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index suppliers_name_lower_uidx on public.suppliers (lower(btrim(name)));
create index suppliers_created_by_idx on public.suppliers (created_by);

create table public.supplier_ledger_entries (
  id bigint generated always as identity primary key,
  supplier_id bigint not null references public.suppliers(id),
  daily_report_id bigint not null references public.daily_reports(id) on delete restrict,
  entry_type text not null check (entry_type in ('purchase', 'payment')),
  amount numeric(14,2) not null check (amount > 0),
  description text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index supplier_ledger_supplier_idx
  on public.supplier_ledger_entries (supplier_id, created_at);
create index supplier_ledger_report_idx
  on public.supplier_ledger_entries (daily_report_id);
create index supplier_ledger_type_idx
  on public.supplier_ledger_entries (entry_type);
create index supplier_ledger_created_by_idx
  on public.supplier_ledger_entries (created_by);

create or replace function public.audit_party_record()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, (select auth.uid()));
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger customers_audit
before insert or update on public.customers
for each row execute function public.audit_party_record();
create trigger suppliers_audit
before insert or update on public.suppliers
for each row execute function public.audit_party_record();

create or replace function public.audit_ledger_entry()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, actor);
    new.updated_by := coalesce(new.updated_by, actor, new.created_by);
  else
    new.created_by := old.created_by;
    new.updated_by := coalesce(actor, old.updated_by);
  end if;
  return new;
end;
$$;

create trigger customer_ledger_audit
before insert or update on public.customer_ledger_entries
for each row execute function public.audit_ledger_entry();
create trigger supplier_ledger_audit
before insert or update on public.supplier_ledger_entries
for each row execute function public.audit_ledger_entry();

create trigger customers_set_updated_at before update on public.customers
for each row execute function public.set_updated_at();
create trigger suppliers_set_updated_at before update on public.suppliers
for each row execute function public.set_updated_at();
create trigger customer_ledger_set_updated_at before update on public.customer_ledger_entries
for each row execute function public.set_updated_at();
create trigger supplier_ledger_set_updated_at before update on public.supplier_ledger_entries
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: all operators collaborate on today's draft; submission locks all edits.
-- ---------------------------------------------------------------------------

drop policy if exists reports_select_own_or_admin on public.daily_reports;
drop policy if exists reports_insert_own_or_admin on public.daily_reports;
drop policy if exists reports_update_own_or_admin on public.daily_reports;

create policy reports_select_current_or_admin on public.daily_reports
for select to authenticated
using (
  business_date = (select public.current_business_date())
  or (select public.is_superadmin())
);

create policy reports_insert_current_or_admin on public.daily_reports
for insert to authenticated
with check (
  (
    business_date = (select public.current_business_date())
    and status = 'draft'
    and submitted_by = (select auth.uid())
  )
  or (select public.is_superadmin())
);

create policy reports_update_draft_or_admin on public.daily_reports
for update to authenticated
using (
  (
    business_date = (select public.current_business_date())
    and status = 'draft'
  )
  or (select public.is_superadmin())
)
with check (
  (
    business_date = (select public.current_business_date())
    and status in ('draft', 'submitted')
  )
  or (select public.is_superadmin())
);

drop policy if exists transactions_select_own_report_or_admin on public.transactions;
drop policy if exists transactions_insert_own_report_or_admin on public.transactions;
drop policy if exists transactions_update_own_report_or_admin on public.transactions;
drop policy if exists transactions_delete_own_report_or_admin on public.transactions;

create policy transactions_select_current_or_admin on public.transactions
for select to authenticated
using (
  exists (
    select 1 from public.daily_reports r
    where r.id = daily_report_id
      and r.business_date = (select public.current_business_date())
  )
  or (select public.is_superadmin())
);

create policy transactions_insert_draft_or_admin on public.transactions
for insert to authenticated
with check (
  (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.daily_reports r
      where r.id = daily_report_id
        and r.business_date = (select public.current_business_date())
        and r.status = 'draft'
    )
  )
  or (select public.is_superadmin())
);

create policy transactions_update_draft_or_admin on public.transactions
for update to authenticated
using (
  exists (
    select 1 from public.daily_reports r
    where r.id = daily_report_id
      and r.business_date = (select public.current_business_date())
      and r.status = 'draft'
  )
  or (select public.is_superadmin())
)
with check (
  exists (
    select 1 from public.daily_reports r
    where r.id = daily_report_id
      and r.business_date = (select public.current_business_date())
      and r.status = 'draft'
  )
  or (select public.is_superadmin())
);

create policy transactions_delete_draft_or_admin on public.transactions
for delete to authenticated
using (
  exists (
    select 1 from public.daily_reports r
    where r.id = daily_report_id
      and r.business_date = (select public.current_business_date())
      and r.status = 'draft'
  )
  or (select public.is_superadmin())
);

alter table public.customers enable row level security;
alter table public.customer_ledger_entries enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_ledger_entries enable row level security;

create policy customers_read_authenticated on public.customers
for select to authenticated using (true);
create policy customers_insert_operator_or_admin on public.customers
for insert to authenticated
with check (
  (created_by = (select auth.uid()) and opening_due = 0)
  or (select public.is_superadmin())
);
create policy customers_admin_update on public.customers
for update to authenticated
using ((select public.is_superadmin())) with check ((select public.is_superadmin()));
create policy customers_admin_delete on public.customers
for delete to authenticated using ((select public.is_superadmin()));

create policy suppliers_read_authenticated on public.suppliers
for select to authenticated using (true);
create policy suppliers_insert_operator_or_admin on public.suppliers
for insert to authenticated
with check (
  (created_by = (select auth.uid()) and opening_due = 0)
  or (select public.is_superadmin())
);
create policy suppliers_admin_update on public.suppliers
for update to authenticated
using ((select public.is_superadmin())) with check ((select public.is_superadmin()));
create policy suppliers_admin_delete on public.suppliers
for delete to authenticated using ((select public.is_superadmin()));

create policy customer_ledger_read_authenticated on public.customer_ledger_entries
for select to authenticated using (true);
create policy customer_ledger_insert_draft_or_admin on public.customer_ledger_entries
for insert to authenticated
with check (
  (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.daily_reports r
      where r.id = daily_report_id
        and r.business_date = (select public.current_business_date())
        and r.status = 'draft'
    )
  )
  or (select public.is_superadmin())
);
create policy customer_ledger_update_draft_or_admin on public.customer_ledger_entries
for update to authenticated
using (
  exists (
    select 1 from public.daily_reports r
    where r.id = daily_report_id
      and r.business_date = (select public.current_business_date())
      and r.status = 'draft'
  )
  or (select public.is_superadmin())
)
with check (
  exists (
    select 1 from public.daily_reports r
    where r.id = daily_report_id
      and r.business_date = (select public.current_business_date())
      and r.status = 'draft'
  )
  or (select public.is_superadmin())
);
create policy customer_ledger_delete_draft_or_admin on public.customer_ledger_entries
for delete to authenticated
using (
  exists (
    select 1 from public.daily_reports r
    where r.id = daily_report_id
      and r.business_date = (select public.current_business_date())
      and r.status = 'draft'
  )
  or (select public.is_superadmin())
);

create policy supplier_ledger_read_authenticated on public.supplier_ledger_entries
for select to authenticated using (true);
create policy supplier_ledger_insert_draft_or_admin on public.supplier_ledger_entries
for insert to authenticated
with check (
  (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.daily_reports r
      where r.id = daily_report_id
        and r.business_date = (select public.current_business_date())
        and r.status = 'draft'
    )
  )
  or (select public.is_superadmin())
);
create policy supplier_ledger_update_draft_or_admin on public.supplier_ledger_entries
for update to authenticated
using (
  exists (
    select 1 from public.daily_reports r
    where r.id = daily_report_id
      and r.business_date = (select public.current_business_date())
      and r.status = 'draft'
  )
  or (select public.is_superadmin())
)
with check (
  exists (
    select 1 from public.daily_reports r
    where r.id = daily_report_id
      and r.business_date = (select public.current_business_date())
      and r.status = 'draft'
  )
  or (select public.is_superadmin())
);
create policy supplier_ledger_delete_draft_or_admin on public.supplier_ledger_entries
for delete to authenticated
using (
  exists (
    select 1 from public.daily_reports r
    where r.id = daily_report_id
      and r.business_date = (select public.current_business_date())
      and r.status = 'draft'
  )
  or (select public.is_superadmin())
);

-- ---------------------------------------------------------------------------
-- Current balance and reporting views. Totals are calculated, never duplicated.
-- ---------------------------------------------------------------------------

create or replace view public.customer_balances
with (security_invoker = true)
as
select
  c.id,
  c.name,
  c.opening_due,
  c.opening_balance_date,
  coalesce(sum(e.amount) filter (where e.entry_type = 'credit_sale'), 0)::numeric(14,2) as total_credit_sales,
  coalesce(sum(e.amount) filter (where e.entry_type = 'credit_recovery'), 0)::numeric(14,2) as total_recovered,
  (
    c.opening_due
    + coalesce(sum(e.amount) filter (where e.entry_type = 'credit_sale'), 0)
    - coalesce(sum(e.amount) filter (where e.entry_type = 'credit_recovery'), 0)
  )::numeric(14,2) as current_due,
  c.active
from public.customers c
left join public.customer_ledger_entries e on e.customer_id = c.id
group by c.id, c.name, c.opening_due, c.opening_balance_date, c.active;

create or replace view public.supplier_balances
with (security_invoker = true)
as
select
  s.id,
  s.name,
  s.opening_due,
  s.opening_balance_date,
  coalesce(sum(e.amount) filter (where e.entry_type = 'purchase'), 0)::numeric(14,2) as total_purchases,
  coalesce(sum(e.amount) filter (where e.entry_type = 'payment'), 0)::numeric(14,2) as total_paid,
  (
    s.opening_due
    + coalesce(sum(e.amount) filter (where e.entry_type = 'purchase'), 0)
    - coalesce(sum(e.amount) filter (where e.entry_type = 'payment'), 0)
  )::numeric(14,2) as current_due,
  s.active
from public.suppliers s
left join public.supplier_ledger_entries e on e.supplier_id = s.id
group by s.id, s.name, s.opening_due, s.opening_balance_date, s.active;

create or replace view public.customer_ledger_history
with (security_invoker = true)
as
select
  e.id,
  r.business_date,
  e.customer_id,
  c.name as customer_name,
  e.entry_type,
  e.amount,
  e.description,
  e.created_by,
  e.updated_by,
  e.created_at,
  e.updated_at,
  e.daily_report_id
from public.customer_ledger_entries e
join public.customers c on c.id = e.customer_id
join public.daily_reports r on r.id = e.daily_report_id;

create or replace view public.supplier_ledger_history
with (security_invoker = true)
as
select
  e.id,
  r.business_date,
  e.supplier_id,
  s.name as supplier_name,
  e.entry_type,
  e.amount,
  e.description,
  e.created_by,
  e.updated_by,
  e.created_at,
  e.updated_at,
  e.daily_report_id
from public.supplier_ledger_entries e
join public.suppliers s on s.id = e.supplier_id
join public.daily_reports r on r.id = e.daily_report_id;

create or replace view public.admin_report_summary
with (security_invoker = true)
as
with legacy as (
  select
    daily_report_id,
    coalesce(sum(amount) filter (where category = 'credit' and transaction_subtype = 'credit_sale'), 0) as credit_sales,
    coalesce(sum(amount) filter (where category = 'credit' and transaction_subtype = 'credit_recovery'), 0) as credit_recovery,
    coalesce(sum(amount) filter (where category = 'supplier_payment'), 0) as supplier_payments,
    coalesce(sum(amount) filter (where category = 'cash_purchase'), 0) as cash_purchases,
    coalesce(sum(amount) filter (where category = 'overhead'), 0) as overhead_cost,
    coalesce(sum(amount) filter (where category = 'conveyance'), 0) as conveyance
  from public.transactions
  group by daily_report_id
), customer_activity as (
  select
    daily_report_id,
    coalesce(sum(amount) filter (where entry_type = 'credit_sale'), 0) as credit_sales,
    coalesce(sum(amount) filter (where entry_type = 'credit_recovery'), 0) as credit_recovery
  from public.customer_ledger_entries
  group by daily_report_id
), supplier_activity as (
  select
    daily_report_id,
    coalesce(sum(amount) filter (where entry_type = 'purchase'), 0) as supplier_purchases,
    coalesce(sum(amount) filter (where entry_type = 'payment'), 0) as supplier_payments
  from public.supplier_ledger_entries
  group by daily_report_id
)
select
  r.id,
  r.business_date,
  r.cash_sales,
  (coalesce(l.credit_sales, 0) + coalesce(c.credit_sales, 0))::numeric(14,2) as credit_sales,
  (coalesce(l.credit_recovery, 0) + coalesce(c.credit_recovery, 0))::numeric(14,2) as credit_recovery,
  (coalesce(l.supplier_payments, 0) + coalesce(s.supplier_payments, 0))::numeric(14,2) as supplier_payments,
  coalesce(l.cash_purchases, 0)::numeric(14,2) as cash_purchases,
  coalesce(l.overhead_cost, 0)::numeric(14,2) as overhead_cost,
  coalesce(l.conveyance, 0)::numeric(14,2) as conveyance,
  coalesce(s.supplier_purchases, 0)::numeric(14,2) as supplier_purchases
from public.daily_reports r
left join legacy l on l.daily_report_id = r.id
left join customer_activity c on c.daily_report_id = r.id
left join supplier_activity s on s.daily_report_id = r.id;

grant select, insert, update, delete on
  public.customers,
  public.customer_ledger_entries,
  public.suppliers,
  public.supplier_ledger_entries
to authenticated;

grant select on
  public.customer_balances,
  public.supplier_balances,
  public.customer_ledger_history,
  public.supplier_ledger_history,
  public.admin_report_summary
to authenticated;

grant usage, select on all sequences in schema public to authenticated;

-- The original whole-report replacement RPC predates the shared ledgers and
-- would erase only legacy transaction rows. Disable it until a ledger-aware
-- submission RPC is introduced with the finalized user workflow.
revoke execute on function public.submit_daily_report(date, numeric, text, text, jsonb)
from authenticated;

commit;
