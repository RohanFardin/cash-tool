begin;

-- Reuse the existing directories and ledgers. A single transaction prevents a
-- failed optional entry from leaving a partially created person or supplier.
create function public.admin_add_history_record(
  p_category text, p_name text, p_phone_number text default null,
  p_entry_type text default null, p_amount numeric default null,
  p_business_date date default null
)
returns bigint language plpgsql set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  name text := nullif(btrim(p_name), '');
  phone text := nullif(btrim(p_phone_number), '');
  record_id bigint;
  report_id bigint;
  report_date date := coalesce(p_business_date, public.current_business_date());
begin
  if not coalesce(public.is_superadmin(), false) then
    raise exception 'Administrator access required';
  end if;
  if p_category is null or p_category not in ('credit', 'supplier', 'overhead') then
    raise exception 'Invalid section';
  end if;
  if name is null or length(name) > 150 then raise exception 'Enter a valid name'; end if;
  if phone is not null and length(phone) > 30 then raise exception 'Phone number is too long'; end if;
  if p_amount is not null and (p_amount::text = 'NaN' or round(p_amount, 2) <= 0 or report_date > public.current_business_date()) then
    raise exception 'Enter a valid amount and report date';
  end if;
  if p_category = 'overhead' then
    if p_amount is not null or p_entry_type is not null then raise exception 'Only an overhead name is needed'; end if;
    insert into public.overhead_categories (name, created_by) values (name, actor) returning id into record_id;
    return record_id;
  end if;
  if p_entry_type is not null and (
    (p_category = 'credit' and p_entry_type not in ('credit_sale', 'credit_recovery'))
    or (p_category = 'supplier' and p_entry_type not in ('purchase', 'payment'))
  ) then raise exception 'Select a valid entry type'; end if;
  if p_amount is not null and p_entry_type is null then raise exception 'Select an entry type for the amount'; end if;

  if p_category = 'credit' then
    insert into public.customers (name, phone_number, created_by) values (name, phone, actor) returning id into record_id;
  else
    insert into public.suppliers (name, phone_number, created_by) values (name, phone, actor) returning id into record_id;
  end if;
  if p_amount is null then return record_id; end if;

  insert into public.daily_reports (business_date, submitted_by)
  values (report_date, actor) on conflict (business_date) do nothing;
  select id into report_id from public.daily_reports where business_date = report_date for update;
  if p_category = 'credit' then
    insert into public.customer_ledger_entries (
      customer_id, daily_report_id, entry_type, amount, phone_number, created_by, updated_by
    ) values (record_id, report_id, p_entry_type, round(p_amount, 2), phone, actor, actor);
  else
    insert into public.supplier_ledger_entries (
      supplier_id, daily_report_id, entry_type, amount, phone_number, created_by, updated_by
    ) values (record_id, report_id, p_entry_type, round(p_amount, 2), phone, actor, actor);
  end if;
  return record_id;
end;
$$;

revoke all on function public.admin_add_history_record(text, text, text, text, numeric, date) from public;
grant execute on function public.admin_add_history_record(text, text, text, text, numeric, date) to authenticated;

commit;
