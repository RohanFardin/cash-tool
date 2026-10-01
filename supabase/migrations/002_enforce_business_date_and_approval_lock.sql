begin;

create or replace function public.current_business_date()
returns date
language sql
stable
set search_path = pg_catalog
as $$
  select (now() at time zone 'Asia/Dhaka')::date;
$$;

revoke all on function public.current_business_date() from public;
grant execute on function public.current_business_date() to authenticated;

drop policy if exists reports_insert_own_or_admin on public.daily_reports;
drop policy if exists reports_update_own_or_admin on public.daily_reports;

create policy reports_insert_own_or_admin on public.daily_reports
for insert to authenticated
with check (
  (
    submitted_by = (select auth.uid())
    and business_date = (select public.current_business_date())
    and status in ('draft', 'submitted')
  )
  or (select public.is_superadmin())
);

create policy reports_update_own_or_admin on public.daily_reports
for update to authenticated
using (
  (
    submitted_by = (select auth.uid())
    and business_date = (select public.current_business_date())
    and status in ('draft', 'submitted')
  )
  or (select public.is_superadmin())
)
with check (
  (
    submitted_by = (select auth.uid())
    and business_date = (select public.current_business_date())
    and status in ('draft', 'submitted')
  )
  or (select public.is_superadmin())
);

drop policy if exists transactions_insert_own_report_or_admin on public.transactions;
drop policy if exists transactions_update_own_report_or_admin on public.transactions;
drop policy if exists transactions_delete_own_report_or_admin on public.transactions;

create policy transactions_insert_own_report_or_admin on public.transactions
for insert to authenticated
with check (
  (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.daily_reports r
      where r.id = daily_report_id
        and r.submitted_by = (select auth.uid())
        and r.business_date = (select public.current_business_date())
        and r.status <> 'approved'
    )
  )
  or (select public.is_superadmin())
);

create policy transactions_update_own_report_or_admin on public.transactions
for update to authenticated
using (
  exists (
    select 1 from public.daily_reports r
    where r.id = daily_report_id
      and r.submitted_by = (select auth.uid())
      and r.business_date = (select public.current_business_date())
      and r.status <> 'approved'
  )
  or (select public.is_superadmin())
)
with check (
  (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.daily_reports r
      where r.id = daily_report_id
        and r.submitted_by = (select auth.uid())
        and r.business_date = (select public.current_business_date())
        and r.status <> 'approved'
    )
  )
  or (select public.is_superadmin())
);

create policy transactions_delete_own_report_or_admin on public.transactions
for delete to authenticated
using (
  exists (
    select 1 from public.daily_reports r
    where r.id = daily_report_id
      and r.submitted_by = (select auth.uid())
      and r.business_date = (select public.current_business_date())
      and r.status <> 'approved'
  )
  or (select public.is_superadmin())
);

commit;
