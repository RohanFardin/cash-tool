begin;

-- Purchase & Payment entries belong to a company's account on a chosen date,
-- outside every daily report. They change the company's due and supplier
-- history, but never a report's totals or the running cash in hand.
alter table public.supplier_ledger_entries
  alter column daily_report_id drop not null,
  add column business_date date,
  add constraint supplier_ledger_report_or_date_check
    check ((daily_report_id is null) <> (business_date is null));

-- Same rules as before for report entries. Only administrators may write an
-- entry without a report; the column is only nullable on supplier entries.
create or replace function public.guard_saved_entry()
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
  if new.daily_report_id is null then
    if not admin_actor then raise exception 'Administrator access required'; end if;
    return new;
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

-- Saves the purchase, the payment, or both for one company in one transaction.
create function public.admin_add_purchase_payment(
  p_supplier_id bigint, p_business_date date,
  p_purchase numeric default null, p_payment numeric default null
)
returns integer language plpgsql set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  purchase numeric := round(p_purchase, 2);
  payment numeric := round(p_payment, 2);
  phone text;
  saved integer := 0;
begin
  if actor is null or not coalesce(public.is_superadmin(), false) then
    raise exception 'Administrator access required';
  end if;
  if p_business_date is null or p_business_date > public.current_business_date() then
    raise exception 'Select today or an earlier date';
  end if;
  if (purchase is null and payment is null)
    or (purchase is not null and (purchase::text = 'NaN' or purchase <= 0))
    or (payment is not null and (payment::text = 'NaN' or payment <= 0)) then
    raise exception 'Enter a purchase or payment amount greater than zero';
  end if;
  select phone_number into phone from public.suppliers where id = p_supplier_id;
  if not found then raise exception 'Select a company'; end if;

  if purchase is not null then
    insert into public.supplier_ledger_entries (
      supplier_id, business_date, entry_type, amount, phone_number, created_by, updated_by
    ) values (p_supplier_id, p_business_date, 'purchase', purchase, phone, actor, actor);
    saved := saved + 1;
  end if;
  if payment is not null then
    insert into public.supplier_ledger_entries (
      supplier_id, business_date, entry_type, amount, phone_number, created_by, updated_by
    ) values (p_supplier_id, p_business_date, 'payment', payment, phone, actor, actor);
    saved := saved + 1;
  end if;
  return saved;
end;
$$;

revoke all on function public.admin_add_purchase_payment(bigint, date, numeric, numeric) from public;
grant execute on function public.admin_add_purchase_payment(bigint, date, numeric, numeric) to authenticated;

-- History reads the entry's own date when it has no report. Report-based
-- totals and cash in hand still select by daily_report_id and exclude it.
create or replace view public.entry_history with (security_invoker = true) as
select 'cash'::text as source, e.id, 'cash_sales'::text as category,
  r.business_date, e.created_at, null::bigint as party_id, null::text as party_name,
  e.entry_type, e.amount, e.daily_report_id, e.created_by, e.updated_by,
  e.updated_at, null::text as description, null::bigint as overhead_category_id,
  null::text as phone_number
from public.cash_sales_entries e join public.daily_reports r on r.id = e.daily_report_id
union all
select 'customer', e.id, 'credit', r.business_date, e.created_at,
  e.customer_id, c.name, e.entry_type, e.amount, e.daily_report_id, e.created_by,
  e.updated_by, e.updated_at, e.description, null::bigint, e.phone_number
from public.customer_ledger_entries e
join public.customers c on c.id = e.customer_id
join public.daily_reports r on r.id = e.daily_report_id
union all
select 'supplier', e.id, 'supplier', coalesce(r.business_date, e.business_date), e.created_at,
  e.supplier_id, s.name, e.entry_type, e.amount, e.daily_report_id, e.created_by,
  e.updated_by, e.updated_at, e.description, null::bigint, e.phone_number
from public.supplier_ledger_entries e
join public.suppliers s on s.id = e.supplier_id
left join public.daily_reports r on r.id = e.daily_report_id
union all
select 'transaction', t.id,
  case when t.category = 'supplier_payment' then 'supplier' else t.category end,
  r.business_date, t.created_at,
  case when t.category = 'credit' then c.id when t.category = 'supplier_payment' then s.id end,
  t.name,
  case when t.category = 'credit' then t.transaction_subtype
    when t.category = 'supplier_payment' then 'payment' else t.category end,
  t.amount, t.daily_report_id, t.created_by, t.updated_by, t.updated_at,
  t.description, t.overhead_category_id, null::text
from public.transactions t join public.daily_reports r on r.id = t.daily_report_id
left join public.customers c on t.category = 'credit' and lower(btrim(c.name)) = lower(btrim(t.name))
left join public.suppliers s on t.category = 'supplier_payment' and lower(btrim(s.name)) = lower(btrim(t.name));

create or replace view public.supplier_ledger_history
with (security_invoker = true)
as
select
  e.id,
  coalesce(r.business_date, e.business_date) as business_date,
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
left join public.daily_reports r on r.id = e.daily_report_id;

commit;
