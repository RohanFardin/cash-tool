begin;

-- Contact details belong to the customer/company record and are copied into
-- submitted ledger entries as a historical snapshot.
alter table public.customers add column phone_number text;
alter table public.suppliers add column phone_number text;

alter table public.customers
  add constraint customers_phone_length_check
  check (phone_number is null or length(phone_number) <= 30);
alter table public.suppliers
  add constraint suppliers_phone_length_check
  check (phone_number is null or length(phone_number) <= 30);

-- Storekeepers can create supplier companies from the same dashboard workflow
-- used for customers. Opening balances remain administrator-controlled.
drop policy suppliers_admin_insert on public.suppliers;
create policy suppliers_insert_operator_or_admin on public.suppliers
for insert to authenticated
with check (
  (created_by = (select auth.uid()) and opening_due = 0)
  or (select public.is_superadmin())
);

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
  c.active,
  c.phone_number,
  c.notes
from public.customers c
left join public.customer_ledger_entries e on e.customer_id = c.id
group by c.id, c.name, c.opening_due, c.opening_balance_date, c.active, c.phone_number, c.notes;

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
  s.active,
  s.phone_number,
  s.notes
from public.suppliers s
left join public.supplier_ledger_entries e on e.supplier_id = s.id
group by s.id, s.name, s.opening_due, s.opening_balance_date, s.active, s.phone_number, s.notes;

-- The browser sends its temporary entries once. This function validates every
-- item, inserts all rows, and submits the report in a single transaction.
create function public.submit_staged_report(p_business_date date, p_entries jsonb)
returns bigint
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  report public.daily_reports%rowtype;
  item jsonb;
  item_kind text;
  item_type text;
  item_category text;
  item_name text;
  item_phone text;
  item_description text;
  item_amount numeric(14,2);
  item_party_id bigint;
  item_overhead_id bigint;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if p_business_date is distinct from public.current_business_date() then
    raise exception 'Only today''s report can be submitted';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Entries must be an array';
  end if;
  if jsonb_array_length(p_entries) > 500 then
    raise exception 'Too many entries in one report';
  end if;

  select * into report from public.daily_reports
  where business_date = p_business_date for update;
  if not found then
    begin
      insert into public.daily_reports (business_date, submitted_by, status, cash_sales)
      values (p_business_date, actor, 'draft', 0)
      returning * into report;
    exception when unique_violation then
      select * into report from public.daily_reports
      where business_date = p_business_date for update;
    end;
  end if;
  if report.status <> 'draft' then raise exception 'This report has already been submitted'; end if;

  for item in select value from jsonb_array_elements(p_entries)
  loop
    item_kind := item ->> 'kind';
    begin
      item_amount := round((item ->> 'amount')::numeric, 2);
    exception when others then
      raise exception 'Every entry needs a valid amount';
    end;
    if item_amount is null or item_amount <= 0 then
      raise exception 'Every entry amount must be greater than zero';
    end if;

    if item_kind = 'cash' then
      insert into public.cash_sales_entries (daily_report_id, amount, created_by)
      values (report.id, item_amount, actor);

    elsif item_kind = 'customer' then
      begin item_party_id := (item ->> 'party_id')::bigint;
      exception when others then raise exception 'Select a customer'; end;
      item_type := item ->> 'entry_type';
      if item_type is null or item_type not in ('credit_sale', 'credit_recovery') then
        raise exception 'Select due amount or due recovery';
      end if;
      select nullif(btrim(coalesce(item ->> 'phone_number', c.phone_number)), ''),
        nullif(btrim(coalesce(item ->> 'description', c.notes)), '')
      into item_phone, item_description
      from public.customers c where c.id = item_party_id and c.active;
      if not found then raise exception 'That customer is not available'; end if;
      insert into public.customer_ledger_entries (
        daily_report_id, customer_id, entry_type, amount, phone_number,
        description, created_by, updated_by
      ) values (
        report.id, item_party_id, item_type, item_amount,
        left(item_phone, 30), left(item_description, 500), actor, actor
      );

    elsif item_kind = 'supplier' then
      begin item_party_id := (item ->> 'party_id')::bigint;
      exception when others then raise exception 'Select a supplier'; end;
      item_type := item ->> 'entry_type';
      if item_type is null or item_type not in ('purchase', 'payment') then
        raise exception 'Select purchase or payment';
      end if;
      select nullif(btrim(coalesce(item ->> 'phone_number', s.phone_number)), ''),
        nullif(btrim(coalesce(item ->> 'description', s.notes)), '')
      into item_phone, item_description
      from public.suppliers s where s.id = item_party_id and s.active;
      if not found then raise exception 'That supplier is not available'; end if;
      insert into public.supplier_ledger_entries (
        daily_report_id, supplier_id, entry_type, amount, phone_number,
        description, created_by, updated_by
      ) values (
        report.id, item_party_id, item_type, item_amount,
        left(item_phone, 30), left(item_description, 500), actor, actor
      );

    elsif item_kind = 'transaction' then
      item_category := item ->> 'category';
      if item_category is null or item_category not in ('cash_purchase', 'overhead', 'conveyance') then
        raise exception 'Invalid transaction category';
      end if;
      item_overhead_id := null;
      if item_category = 'overhead' then
        begin item_overhead_id := (item ->> 'overhead_category_id')::bigint;
        exception when others then raise exception 'Select an overhead cost'; end;
        select name into item_name from public.overhead_categories
        where id = item_overhead_id and active;
        if not found then raise exception 'That overhead option is not available'; end if;
      else
        item_name := case when item_category = 'cash_purchase' then 'Local Supplier' else 'Conveyance' end;
      end if;
      insert into public.transactions (
        daily_report_id, category, transaction_subtype, name, amount,
        description, overhead_category_id, created_by, updated_by
      ) values (
        report.id, item_category, null, item_name, item_amount,
        null, item_overhead_id, actor, actor
      );
    else
      raise exception 'Invalid staged entry type';
    end if;
  end loop;

  update public.daily_reports set status = 'submitted' where id = report.id;
  return report.id;
end;
$$;

revoke all on function public.submit_staged_report(date, jsonb) from public;
grant execute on function public.submit_staged_report(date, jsonb) to authenticated;

grant select on public.customer_balances, public.supplier_balances to authenticated;

commit;
