begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (btrim(full_name) <> ''),
  role text not null default 'user' check (role in ('user', 'superadmin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_reports (
  id bigint generated always as identity primary key,
  business_date date not null unique,
  cash_sales numeric(14,2) not null default 0 check (cash_sales >= 0),
  submitted_by uuid not null references public.profiles(id),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transactions (
  id bigint generated always as identity primary key,
  daily_report_id bigint not null references public.daily_reports(id) on delete cascade,
  category text not null check (category in ('credit', 'supplier_payment', 'cash_purchase', 'overhead', 'conveyance')),
  transaction_subtype text,
  name text not null check (btrim(name) <> ''),
  amount numeric(14,2) not null check (amount > 0),
  description text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_subtype_check check (
    (category = 'credit' and transaction_subtype in ('credit_sale', 'credit_recovery'))
    or (category <> 'credit' and transaction_subtype is null)
  )
);

create index daily_reports_submitted_by_idx on public.daily_reports (submitted_by);
-- The UNIQUE constraint already indexes business_date.
create index transactions_daily_report_id_idx on public.transactions (daily_report_id);
create index transactions_category_idx on public.transactions (category);
create index transactions_created_by_idx on public.transactions (created_by);
create index transactions_name_idx on public.transactions (name);
create index transactions_report_category_subtype_idx
  on public.transactions (daily_report_id, category, transaction_subtype);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger daily_reports_set_updated_at before update on public.daily_reports
for each row execute function public.set_updated_at();
create trigger transactions_set_updated_at before update on public.transactions
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  derived_name text;
begin
  derived_name := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(derived_name, split_part(coalesce(new.email, new.id::text), '@', 1)), 'user');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'superadmin'
  );
$$;

revoke all on function public.is_superadmin() from public;
grant execute on function public.is_superadmin() to authenticated;

alter table public.profiles enable row level security;
alter table public.daily_reports enable row level security;
alter table public.transactions enable row level security;

create policy profiles_select_own_or_admin on public.profiles
for select to authenticated
using (id = (select auth.uid()) or (select public.is_superadmin()));

create policy profiles_admin_insert on public.profiles
for insert to authenticated
with check ((select public.is_superadmin()));
create policy profiles_admin_update on public.profiles
for update to authenticated
using ((select public.is_superadmin())) with check ((select public.is_superadmin()));
create policy profiles_admin_delete on public.profiles
for delete to authenticated
using ((select public.is_superadmin()));

create policy reports_select_own_or_admin on public.daily_reports
for select to authenticated
using (submitted_by = (select auth.uid()) or (select public.is_superadmin()));
create policy reports_insert_own_or_admin on public.daily_reports
for insert to authenticated
with check (
  (submitted_by = (select auth.uid()) and status in ('draft', 'submitted'))
  or (select public.is_superadmin())
);
create policy reports_update_own_or_admin on public.daily_reports
for update to authenticated
using (
  (submitted_by = (select auth.uid()) and status in ('draft', 'submitted'))
  or (select public.is_superadmin())
)
with check (
  (submitted_by = (select auth.uid()) and status in ('draft', 'submitted'))
  or (select public.is_superadmin())
);
create policy reports_admin_delete on public.daily_reports
for delete to authenticated using ((select public.is_superadmin()));

create policy transactions_select_own_report_or_admin on public.transactions
for select to authenticated
using (
  exists (select 1 from public.daily_reports r where r.id = daily_report_id and r.submitted_by = (select auth.uid()))
  or (select public.is_superadmin())
);
create policy transactions_insert_own_report_or_admin on public.transactions
for insert to authenticated
with check (
  (created_by = (select auth.uid()) and exists (
    select 1 from public.daily_reports r where r.id = daily_report_id and r.submitted_by = (select auth.uid())
  )) or (select public.is_superadmin())
);
create policy transactions_update_own_report_or_admin on public.transactions
for update to authenticated
using (
  exists (select 1 from public.daily_reports r where r.id = daily_report_id and r.submitted_by = (select auth.uid()))
  or (select public.is_superadmin())
)
with check (
  (created_by = (select auth.uid()) and exists (
    select 1 from public.daily_reports r where r.id = daily_report_id and r.submitted_by = (select auth.uid())
  )) or (select public.is_superadmin())
);
create policy transactions_delete_own_report_or_admin on public.transactions
for delete to authenticated
using (
  exists (select 1 from public.daily_reports r where r.id = daily_report_id and r.submitted_by = (select auth.uid()))
  or (select public.is_superadmin())
);

create or replace view public.admin_report_summary
with (security_invoker = true)
as
select
  r.id,
  r.business_date,
  r.cash_sales,
  coalesce(sum(t.amount) filter (where t.category = 'credit' and t.transaction_subtype = 'credit_sale'), 0)::numeric(14,2) as credit_sales,
  coalesce(sum(t.amount) filter (where t.category = 'credit' and t.transaction_subtype = 'credit_recovery'), 0)::numeric(14,2) as credit_recovery,
  coalesce(sum(t.amount) filter (where t.category = 'supplier_payment'), 0)::numeric(14,2) as supplier_payments,
  coalesce(sum(t.amount) filter (where t.category = 'cash_purchase'), 0)::numeric(14,2) as cash_purchases,
  coalesce(sum(t.amount) filter (where t.category = 'overhead'), 0)::numeric(14,2) as overhead_cost,
  coalesce(sum(t.amount) filter (where t.category = 'conveyance'), 0)::numeric(14,2) as conveyance
from public.daily_reports r
left join public.transactions t on t.daily_report_id = r.id
group by r.id, r.business_date, r.cash_sales;

create or replace function public.submit_daily_report(
  p_business_date date,
  p_cash_sales numeric,
  p_notes text default null,
  p_status text default 'submitted',
  p_transactions jsonb default '[]'::jsonb
)
returns bigint
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  report_id bigint;
  item jsonb;
  item_category text;
  item_subtype text;
  item_name text;
  item_amount numeric;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_business_date is null then raise exception 'Business date is required'; end if;
  if p_cash_sales is null or p_cash_sales < 0 then raise exception 'Cash sales must be zero or greater'; end if;
  if p_status not in ('draft', 'submitted', 'approved') then raise exception 'Invalid status'; end if;
  if not (select public.is_superadmin()) and p_status = 'approved' then raise exception 'Only a superadmin may approve reports'; end if;
  if jsonb_typeof(p_transactions) <> 'array' then raise exception 'Transactions must be an array'; end if;

  insert into public.daily_reports (business_date, cash_sales, submitted_by, status, notes)
  values (p_business_date, p_cash_sales, (select auth.uid()), p_status, nullif(btrim(p_notes), ''))
  on conflict (business_date) do update
    set cash_sales = excluded.cash_sales, status = excluded.status, notes = excluded.notes
  returning id into report_id;

  delete from public.transactions where daily_report_id = report_id;

  for item in select value from jsonb_array_elements(p_transactions)
  loop
    item_category := item ->> 'category';
    item_subtype := nullif(btrim(item ->> 'transaction_subtype'), '');
    item_name := nullif(btrim(item ->> 'name'), '');
    begin
      item_amount := (item ->> 'amount')::numeric;
    exception when invalid_text_representation then
      raise exception 'Transaction amount must be numeric';
    end;

    insert into public.transactions (
      daily_report_id, category, transaction_subtype, name, amount, description, created_by
    ) values (
      report_id, item_category, item_subtype, item_name, item_amount,
      nullif(btrim(item ->> 'description'), ''), (select auth.uid())
    );
  end loop;

  return report_id;
end;
$$;

revoke all on function public.submit_daily_report(date, numeric, text, text, jsonb) from public;
grant execute on function public.submit_daily_report(date, numeric, text, text, jsonb) to authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles, public.daily_reports, public.transactions, public.admin_report_summary to authenticated;
grant insert, update, delete on public.profiles, public.daily_reports, public.transactions to authenticated;
grant usage, select on all sequences in schema public to authenticated;

commit;
