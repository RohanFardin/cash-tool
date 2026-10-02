begin;

-- Keep each cash entry, including the last saved total from the old workflow.
create table public.cash_sales_entries (
  id bigint generated always as identity primary key,
  daily_report_id bigint not null references public.daily_reports(id) on delete restrict,
  amount numeric(14,2) not null,
  entry_type text not null default 'cash_sale'
    check (entry_type in ('cash_sale', 'previous_total', 'adjustment')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (amount > 0 or (entry_type = 'adjustment' and amount < 0))
);

create index cash_sales_report_idx on public.cash_sales_entries (daily_report_id, created_at);

insert into public.cash_sales_entries (daily_report_id, amount, entry_type, created_by, created_at)
select id, cash_sales, 'previous_total', coalesce(cash_sales_updated_by, created_by), updated_at
from public.daily_reports where cash_sales > 0;

alter table public.cash_sales_entries enable row level security;
create policy cash_sales_read on public.cash_sales_entries
for select to authenticated using (true);
create policy cash_sales_insert on public.cash_sales_entries
for insert to authenticated with check (
  (
    created_by = (select auth.uid()) and entry_type = 'cash_sale' and amount > 0
    and exists (
      select 1 from public.daily_reports r where r.id = daily_report_id
        and r.business_date = (select public.current_business_date()) and r.status = 'draft'
    )
  ) or (select public.is_superadmin())
);
create policy cash_sales_admin_update on public.cash_sales_entries
for update to authenticated
using ((select public.is_superadmin())) with check ((select public.is_superadmin()));
create policy cash_sales_admin_delete on public.cash_sales_entries
for delete to authenticated using ((select public.is_superadmin()));

-- Reading history must also work for reports from previous business days.
drop policy reports_select_current_or_admin on public.daily_reports;
create policy reports_read_authenticated on public.daily_reports
for select to authenticated using (true);
drop policy transactions_select_current_or_admin on public.transactions;
create policy transactions_read_authenticated on public.transactions
for select to authenticated using (true);

-- Operators append entries; only administrators can correct saved records.
drop policy transactions_update_draft_or_admin on public.transactions;
drop policy transactions_delete_draft_or_admin on public.transactions;
create policy transactions_admin_update on public.transactions
for update to authenticated
using ((select public.is_superadmin())) with check ((select public.is_superadmin()));
create policy transactions_admin_delete on public.transactions
for delete to authenticated using ((select public.is_superadmin()));
drop policy customer_ledger_update_draft_or_admin on public.customer_ledger_entries;
drop policy customer_ledger_delete_draft_or_admin on public.customer_ledger_entries;
create policy customer_ledger_admin_update on public.customer_ledger_entries
for update to authenticated
using ((select public.is_superadmin())) with check ((select public.is_superadmin()));
create policy customer_ledger_admin_delete on public.customer_ledger_entries
for delete to authenticated using ((select public.is_superadmin()));
drop policy supplier_ledger_update_draft_or_admin on public.supplier_ledger_entries;
drop policy supplier_ledger_delete_draft_or_admin on public.supplier_ledger_entries;
create policy supplier_ledger_admin_update on public.supplier_ledger_entries
for update to authenticated
using ((select public.is_superadmin())) with check ((select public.is_superadmin()));
create policy supplier_ledger_admin_delete on public.supplier_ledger_entries
for delete to authenticated using ((select public.is_superadmin()));

-- Serialize saving with final submission. An insert that waits for submission
-- must recheck the locked report rather than slip into a submitted report.
create function public.guard_saved_entry()
returns trigger language plpgsql
set search_path = pg_catalog, public
as $$
declare
  report public.daily_reports%rowtype;
  admin_actor boolean := coalesce(public.is_superadmin(), false);
begin
  if tg_op <> 'INSERT' and not admin_actor then
    raise exception 'Saved entries cannot be edited or deleted';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' then
    new.daily_report_id := old.daily_report_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  select * into report from public.daily_reports
  where id = new.daily_report_id for update;
  if not found then raise exception 'Report is not available'; end if;
  if not admin_actor then
    if report.business_date <> public.current_business_date() or report.status <> 'draft' then
      raise exception 'This report is locked for entries';
    end if;
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger cash_sales_guard before insert or update or delete on public.cash_sales_entries
for each row execute function public.guard_saved_entry();
create trigger customer_entries_guard before insert or update or delete on public.customer_ledger_entries
for each row execute function public.guard_saved_entry();
create trigger supplier_entries_guard before insert or update or delete on public.supplier_ledger_entries
for each row execute function public.guard_saved_entry();
create trigger transactions_guard before insert or update or delete on public.transactions
for each row execute function public.guard_saved_entry();

-- Maintain the existing daily total atomically so summaries and admin reports
-- continue to agree with the individual cash entries.
create function public.sync_cash_sales_total()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  report_id bigint;
  delta numeric(14,2);
begin
  report_id := case when tg_op = 'DELETE' then old.daily_report_id else new.daily_report_id end;
  delta := case when tg_op = 'INSERT' then new.amount
    when tg_op = 'DELETE' then -old.amount else new.amount - old.amount end;
  update public.daily_reports set cash_sales = cash_sales + delta where id = report_id;
  return null;
end;
$$;
revoke all on function public.sync_cash_sales_total() from public;
create trigger cash_sales_sync after insert or update or delete on public.cash_sales_entries
for each row execute function public.sync_cash_sales_total();

create function public.guard_cash_sales_total()
returns trigger language plpgsql set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if new.cash_sales <> 0 then raise exception 'Record cash sales as individual entries'; end if;
  elsif new.cash_sales is distinct from old.cash_sales and pg_trigger_depth() = 1 then
    raise exception 'Record cash sales as individual entries';
  end if;
  return new;
end;
$$;
create trigger daily_reports_cash_guard before insert or update on public.daily_reports
for each row execute function public.guard_cash_sales_total();

-- Existing administrator edits become timestamped adjustments, so changing a
-- daily cash total cannot silently disagree with cash-sales history.
create function public.admin_update_daily_report(
  p_report_id bigint, p_cash_sales numeric, p_status text, p_notes text
)
returns void language plpgsql set search_path = pg_catalog, public
as $$
declare
  report public.daily_reports%rowtype;
  delta numeric(14,2);
begin
  if not coalesce(public.is_superadmin(), false) then
    raise exception 'Administrator access required';
  end if;
  if p_cash_sales is null or p_cash_sales < 0 or p_status is null
    or p_status not in ('draft', 'submitted', 'approved') then
    raise exception 'Invalid report values';
  end if;
  select * into report from public.daily_reports where id = p_report_id for update;
  if not found then raise exception 'Report is not available'; end if;
  delta := round(p_cash_sales, 2) - report.cash_sales;
  if delta <> 0 then
    insert into public.cash_sales_entries (daily_report_id, amount, entry_type, created_by)
    values (p_report_id, delta, 'adjustment', auth.uid());
  end if;
  update public.daily_reports set status = p_status, notes = p_notes where id = p_report_id;
end;
$$;
revoke all on function public.admin_update_daily_report(bigint, numeric, text, text) from public;
grant execute on function public.admin_update_daily_report(bigint, numeric, text, text) to authenticated;

-- One read-only view covers current ledgers and pre-ledger transaction history.
create view public.entry_history with (security_invoker = true) as
select 'cash'::text as source, e.id, 'cash_sales'::text as category,
  r.business_date, e.created_at, null::bigint as party_id, null::text as party_name,
  e.entry_type, e.amount
from public.cash_sales_entries e join public.daily_reports r on r.id = e.daily_report_id
union all
select 'customer', e.id, 'credit', r.business_date, e.created_at,
  e.customer_id, c.name, e.entry_type, e.amount
from public.customer_ledger_entries e
join public.customers c on c.id = e.customer_id
join public.daily_reports r on r.id = e.daily_report_id
union all
select 'supplier', e.id, 'supplier', r.business_date, e.created_at,
  e.supplier_id, s.name, e.entry_type, e.amount
from public.supplier_ledger_entries e
join public.suppliers s on s.id = e.supplier_id
join public.daily_reports r on r.id = e.daily_report_id
union all
select 'transaction', t.id,
  case when t.category = 'supplier_payment' then 'supplier' else t.category end,
  r.business_date, t.created_at,
  case when t.category = 'credit' then c.id when t.category = 'supplier_payment' then s.id end,
  t.name,
  case when t.category = 'credit' then t.transaction_subtype
    when t.category = 'supplier_payment' then 'payment' else t.category end,
  t.amount
from public.transactions t join public.daily_reports r on r.id = t.daily_report_id
left join public.customers c on t.category = 'credit' and lower(btrim(c.name)) = lower(btrim(t.name))
left join public.suppliers s on t.category = 'supplier_payment' and lower(btrim(s.name)) = lower(btrim(t.name));

-- Totals span the complete filtered history, independently of pagination.
create function public.entry_history_totals(p_category text, p_party_id bigint default null)
returns table (entry_count bigint, primary_total numeric, secondary_total numeric)
language sql stable set search_path = pg_catalog, public
as $$
  select count(*),
    coalesce(sum(amount) filter (where entry_type not in ('credit_recovery', 'payment')), 0),
    coalesce(sum(amount) filter (where entry_type in ('credit_recovery', 'payment')), 0)
  from public.entry_history where category = p_category
    and (p_party_id is null or party_id = p_party_id);
$$;
revoke all on function public.entry_history_totals(text, bigint) from public;
grant execute on function public.entry_history_totals(text, bigint) to authenticated;
grant select on public.entry_history to authenticated;
grant select, insert, update, delete on public.cash_sales_entries to authenticated;
grant usage, select on all sequences in schema public to authenticated;

commit;
