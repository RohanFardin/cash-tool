begin;

-- Contact numbers are stored on each ledger entry so historical records keep
-- the number that was supplied at the time of the transaction.
alter table public.customer_ledger_entries add column phone_number text;
alter table public.supplier_ledger_entries add column phone_number text;

alter table public.customer_ledger_entries
  add constraint customer_ledger_phone_length_check
  check (phone_number is null or length(phone_number) <= 30);
alter table public.supplier_ledger_entries
  add constraint supplier_ledger_phone_length_check
  check (phone_number is null or length(phone_number) <= 30);

-- Draft reports deliberately keep this value null. It becomes the stored,
-- server-calculated closing cash figure when the report is submitted.
alter table public.daily_reports add column cash_in_hand numeric(14,2);

create function public.calculate_report_cash_in_hand(
  p_report_id bigint,
  p_cash_sales numeric default null
)
returns numeric
language sql
stable
set search_path = pg_catalog, public
as $$
  select round(
    coalesce(p_cash_sales, (select r.cash_sales from public.daily_reports r where r.id = p_report_id), 0)
    + coalesce((
      select sum(e.amount) from public.customer_ledger_entries e
      where e.daily_report_id = p_report_id and e.entry_type = 'credit_recovery'
    ), 0)
    + coalesce((
      select sum(t.amount) from public.transactions t
      where t.daily_report_id = p_report_id
        and t.category = 'credit' and t.transaction_subtype = 'credit_recovery'
    ), 0)
    - coalesce((
      select sum(e.amount) from public.supplier_ledger_entries e
      where e.daily_report_id = p_report_id and e.entry_type = 'payment'
    ), 0)
    - coalesce((
      select sum(t.amount) from public.transactions t
      where t.daily_report_id = p_report_id
        and t.category in ('supplier_payment', 'cash_purchase', 'overhead', 'conveyance')
    ), 0)
  , 2)::numeric(14,2);
$$;

revoke all on function public.calculate_report_cash_in_hand(bigint, numeric) from public;
grant execute on function public.calculate_report_cash_in_hand(bigint, numeric) to authenticated;

-- Preserve cash-in-hand for reports that were already submitted before this
-- migration. Draft rows remain empty until their final submission.
alter table public.daily_reports disable trigger daily_reports_audit;
update public.daily_reports r
set cash_in_hand = public.calculate_report_cash_in_hand(r.id, r.cash_sales)
where r.status in ('submitted', 'approved');
alter table public.daily_reports enable trigger daily_reports_audit;

create function public.set_daily_report_cash_in_hand()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'draft' then
    new.cash_in_hand := null;
  else
    new.cash_in_hand := public.calculate_report_cash_in_hand(new.id, new.cash_sales);
  end if;
  return new;
end;
$$;

create trigger daily_reports_cash_in_hand
before insert or update on public.daily_reports
for each row execute function public.set_daily_report_cash_in_hand();

-- Administrator corrections to submitted ledger entries keep the stored cash
-- figure aligned with the corrected report. Operator inserts only affect drafts.
create function public.refresh_report_cash_in_hand()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  report_id bigint := case when tg_op = 'DELETE' then old.daily_report_id else new.daily_report_id end;
begin
  update public.daily_reports
  set cash_in_hand = public.calculate_report_cash_in_hand(report_id)
  where id = report_id and status in ('submitted', 'approved');
  return null;
end;
$$;

create trigger customer_entries_cash_in_hand
after insert or update or delete on public.customer_ledger_entries
for each row execute function public.refresh_report_cash_in_hand();
create trigger supplier_entries_cash_in_hand
after insert or update or delete on public.supplier_ledger_entries
for each row execute function public.refresh_report_cash_in_hand();
create trigger transactions_cash_in_hand
after insert or update or delete on public.transactions
for each row execute function public.refresh_report_cash_in_hand();

-- Append the contact number to the shared history view. Legacy transactions
-- have no captured number, while current ledger entries retain their snapshot.
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
select 'supplier', e.id, 'supplier', r.business_date, e.created_at,
  e.supplier_id, s.name, e.entry_type, e.amount, e.daily_report_id, e.created_by,
  e.updated_by, e.updated_at, e.description, null::bigint, e.phone_number
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
  t.description, t.overhead_category_id, null::text
from public.transactions t join public.daily_reports r on r.id = t.daily_report_id
left join public.customers c on t.category = 'credit' and lower(btrim(c.name)) = lower(btrim(t.name))
left join public.suppliers s on t.category = 'supplier_payment' and lower(btrim(s.name)) = lower(btrim(t.name));

grant select on public.entry_history to authenticated;

commit;
