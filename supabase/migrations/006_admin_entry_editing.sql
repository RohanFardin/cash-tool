begin;

-- Cash entries get the same edit attribution as the other ledgers. The guard
-- from migration 005 preserves their original author and entry timestamp.
alter table public.cash_sales_entries
  add column updated_by uuid references public.profiles(id),
  add column updated_at timestamptz not null default now();
-- This metadata backfill runs as the database owner, without an Auth identity.
-- Do not treat it as an entry edit or resync already correct daily totals.
alter table public.cash_sales_entries disable trigger cash_sales_guard;
alter table public.cash_sales_entries disable trigger cash_sales_sync;
update public.cash_sales_entries set updated_by = created_by, updated_at = created_at;
alter table public.cash_sales_entries enable trigger cash_sales_guard;
alter table public.cash_sales_entries enable trigger cash_sales_sync;
alter table public.cash_sales_entries alter column updated_by set not null;
create trigger cash_sales_audit before insert or update on public.cash_sales_entries
for each row execute function public.audit_ledger_entry();
create trigger cash_sales_set_updated_at before update on public.cash_sales_entries
for each row execute function public.set_updated_at();

-- Add editor fields after the existing columns so dependent queries keep the
-- same column identities. This view still obeys the underlying table policies.
create or replace view public.entry_history with (security_invoker = true) as
select 'cash'::text as source, e.id, 'cash_sales'::text as category,
  r.business_date, e.created_at, null::bigint as party_id, null::text as party_name,
  e.entry_type, e.amount, e.daily_report_id, e.created_by, e.updated_by,
  e.updated_at, null::text as description, null::bigint as overhead_category_id
from public.cash_sales_entries e join public.daily_reports r on r.id = e.daily_report_id
union all
select 'customer', e.id, 'credit', r.business_date, e.created_at,
  e.customer_id, c.name, e.entry_type, e.amount, e.daily_report_id, e.created_by,
  e.updated_by, e.updated_at, e.description, null::bigint
from public.customer_ledger_entries e
join public.customers c on c.id = e.customer_id
join public.daily_reports r on r.id = e.daily_report_id
union all
select 'supplier', e.id, 'supplier', r.business_date, e.created_at,
  e.supplier_id, s.name, e.entry_type, e.amount, e.daily_report_id, e.created_by,
  e.updated_by, e.updated_at, e.description, null::bigint
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
  t.amount, t.daily_report_id, t.created_by, t.updated_by, t.updated_at,
  t.description, t.overhead_category_id
from public.transactions t join public.daily_reports r on r.id = t.daily_report_id
left join public.customers c on t.category = 'credit' and lower(btrim(c.name)) = lower(btrim(t.name))
left join public.suppliers s on t.category = 'supplier_payment' and lower(btrim(s.name)) = lower(btrim(t.name));

drop function public.entry_history_totals(text, bigint);
create function public.entry_history_totals(
  p_category text, p_party_id bigint default null, p_business_date date default null
)
returns table (entry_count bigint, primary_total numeric, secondary_total numeric)
language sql stable set search_path = pg_catalog, public
as $$
  select count(*),
    coalesce(sum(amount) filter (where entry_type not in ('credit_recovery', 'payment')), 0),
    coalesce(sum(amount) filter (where entry_type in ('credit_recovery', 'payment')), 0)
  from public.entry_history
  where (p_category is null or category = p_category)
    and (p_party_id is null or party_id = p_party_id)
    and (p_business_date is null or business_date = p_business_date);
$$;
revoke all on function public.entry_history_totals(text, bigint, date) from public;
grant execute on function public.entry_history_totals(text, bigint, date) to authenticated;

-- Only a verified administrator can update the original entry. The source is
-- checked against a fixed set of tables; timestamps and authors are not inputs.
create function public.admin_edit_entry(
  p_source text, p_id bigint, p_amount numeric, p_party_id bigint default null,
  p_entry_type text default null, p_overhead_category_id bigint default null,
  p_description text default null
)
returns date language plpgsql set search_path = pg_catalog, public
as $$
declare
  report_id bigint;
  old_type text;
  transaction_category text;
  party_name text;
  report_date date;
begin
  if not coalesce(public.is_superadmin(), false) then
    raise exception 'Administrator access required';
  end if;
  if p_amount is null or p_amount = 0 or p_id is null then
    raise exception 'Enter a valid amount';
  end if;

  if p_source = 'cash' then
    select daily_report_id, entry_type into report_id, old_type
    from public.cash_sales_entries where id = p_id for update;
    if not found then raise exception 'Entry is not available'; end if;
    if p_amount < 0 and old_type <> 'adjustment' then
      raise exception 'Amount must be greater than zero';
    end if;
    update public.cash_sales_entries set amount = p_amount where id = p_id;
  elsif p_source = 'customer' then
    if p_entry_type is null or p_entry_type not in ('credit_sale', 'credit_recovery') or p_amount < 0 then
      raise exception 'Invalid credit entry';
    end if;
    select daily_report_id into report_id from public.customer_ledger_entries where id = p_id for update;
    if not found then raise exception 'Entry is not available'; end if;
    if not exists (select 1 from public.customers where id = p_party_id) then
      raise exception 'Select a customer';
    end if;
    update public.customer_ledger_entries set customer_id = p_party_id,
      entry_type = p_entry_type, amount = p_amount, description = p_description where id = p_id;
  elsif p_source = 'supplier' then
    if p_entry_type is null or p_entry_type not in ('purchase', 'payment') or p_amount < 0 then
      raise exception 'Invalid supplier entry';
    end if;
    select daily_report_id into report_id from public.supplier_ledger_entries where id = p_id for update;
    if not found then raise exception 'Entry is not available'; end if;
    if not exists (select 1 from public.suppliers where id = p_party_id) then
      raise exception 'Select a company';
    end if;
    update public.supplier_ledger_entries set supplier_id = p_party_id,
      entry_type = p_entry_type, amount = p_amount, description = p_description where id = p_id;
  elsif p_source = 'transaction' then
    if p_amount < 0 then raise exception 'Amount must be greater than zero'; end if;
    select daily_report_id, category into report_id, transaction_category
    from public.transactions where id = p_id for update;
    if not found then raise exception 'Entry is not available'; end if;
    if transaction_category = 'credit' then
      if p_entry_type is null or p_entry_type not in ('credit_sale', 'credit_recovery') then
        raise exception 'Select sale or recovery';
      end if;
      select name into party_name from public.customers where id = p_party_id;
      if not found then raise exception 'Select a customer'; end if;
      update public.transactions set name = party_name, transaction_subtype = p_entry_type,
        amount = p_amount, description = p_description where id = p_id;
    elsif transaction_category = 'supplier_payment' then
      if p_entry_type is distinct from 'payment' then
        raise exception 'Earlier supplier entries are payments';
      end if;
      select name into party_name from public.suppliers where id = p_party_id;
      if not found then raise exception 'Select a company'; end if;
      update public.transactions set name = party_name, amount = p_amount, description = p_description where id = p_id;
    elsif transaction_category = 'overhead' then
      select name into party_name from public.overhead_categories where id = p_overhead_category_id;
      if not found then raise exception 'Select an overhead cost'; end if;
      update public.transactions set name = party_name, overhead_category_id = p_overhead_category_id,
        amount = p_amount, description = p_description where id = p_id;
    else
      update public.transactions set amount = p_amount, description = p_description where id = p_id;
    end if;
  else
    raise exception 'Invalid entry source';
  end if;

  select business_date into report_date from public.daily_reports where id = report_id;
  return report_date;
end;
$$;
revoke all on function public.admin_edit_entry(text, bigint, numeric, bigint, text, bigint, text) from public;
grant execute on function public.admin_edit_entry(text, bigint, numeric, bigint, text, bigint, text) to authenticated;

commit;
