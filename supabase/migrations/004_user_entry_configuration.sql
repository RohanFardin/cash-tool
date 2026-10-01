begin;

-- Storekeepers collaborate by name, but credentials remain private in auth.users.
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_authenticated on public.profiles
for select to authenticated using (true);

-- Suppliers are configured by an administrator, never created from the user portal.
drop policy if exists suppliers_insert_operator_or_admin on public.suppliers;
create policy suppliers_admin_insert on public.suppliers
for insert to authenticated
with check ((select public.is_superadmin()));

-- Administrators configure the available overhead choices (rent, electricity, etc.).
create table public.overhead_categories (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index overhead_categories_name_lower_uidx
  on public.overhead_categories (lower(btrim(name)));
create index overhead_categories_active_idx
  on public.overhead_categories (active, name);

create trigger overhead_categories_audit
before insert or update on public.overhead_categories
for each row execute function public.audit_party_record();

create trigger overhead_categories_set_updated_at
before update on public.overhead_categories
for each row execute function public.set_updated_at();

alter table public.overhead_categories enable row level security;

create policy overhead_categories_read on public.overhead_categories
for select to authenticated
using (active or (select public.is_superadmin()));
create policy overhead_categories_admin_insert on public.overhead_categories
for insert to authenticated
with check ((select public.is_superadmin()));
create policy overhead_categories_admin_update on public.overhead_categories
for update to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));
create policy overhead_categories_admin_delete on public.overhead_categories
for delete to authenticated
using ((select public.is_superadmin()));

alter table public.transactions
  add column overhead_category_id bigint
  references public.overhead_categories(id) on delete restrict;

create index transactions_overhead_category_idx
  on public.transactions (overhead_category_id)
  where overhead_category_id is not null;

-- NOT VALID preserves any legacy overhead rows. PostgreSQL still checks every
-- new or updated row, so all new overhead entries must use an admin-made option.
alter table public.transactions
  add constraint transactions_overhead_category_check
  check (
    (category = 'overhead' and overhead_category_id is not null)
    or (category <> 'overhead' and overhead_category_id is null)
  ) not valid;

grant select, insert, update, delete on public.overhead_categories to authenticated;
grant usage, select on all sequences in schema public to authenticated;

commit;
