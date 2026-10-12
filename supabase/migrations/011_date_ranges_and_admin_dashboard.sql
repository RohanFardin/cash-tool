begin;

-- Date ranges are inclusive. Totals use the full filtered history, not just a page.
drop function public.entry_history_totals(text, bigint, date);
create function public.entry_history_totals(
  p_category text, p_party_id bigint default null, p_business_date date default null,
  p_date_from date default null, p_date_to date default null
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
    and (p_business_date is null or business_date = p_business_date)
    and (p_date_from is null or business_date >= p_date_from)
    and (p_date_to is null or business_date <= p_date_to);
$$;
revoke all on function public.entry_history_totals(text, bigint, date, date, date) from public;
grant execute on function public.entry_history_totals(text, bigint, date, date, date) to authenticated;

drop function public.cash_sales_history_totals(date);
create function public.cash_sales_history_totals(
  p_business_date date default null, p_date_from date default null, p_date_to date default null
)
returns table (report_count bigint, total_sales numeric, cash_in_hand numeric)
language sql stable set search_path = pg_catalog, public
as $$
  select count(*), coalesce(sum(b.total_sales), 0),
    coalesce((array_agg(b.cash_in_hand order by b.business_date desc))[1], 0)
  from public.daily_cash_balances b
  where b.business_date <= public.current_business_date()
    and (p_business_date is null or b.business_date = p_business_date)
    and (p_date_from is null or b.business_date >= p_date_from)
    and (p_date_to is null or b.business_date <= p_date_to);
$$;
revoke all on function public.cash_sales_history_totals(date, date, date) from public;
grant execute on function public.cash_sales_history_totals(date, date, date) to authenticated;

-- Use the same atomic entry validation and contact snapshots as the user batch.
-- Admin batches additionally support earlier dates and already submitted reports.
create function public.admin_save_staged_report(p_business_date date, p_entries jsonb)
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
  if actor is null or not coalesce(public.is_superadmin(), false) then raise exception 'Administrator access required'; end if;
  if p_business_date is null or p_business_date > public.current_business_date() then
    raise exception 'Select today or an earlier report date';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Entries must be an array';
  end if;
  if jsonb_array_length(p_entries) < 1 or jsonb_array_length(p_entries) > 500 then
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
  -- Administrators can append missed entries to submitted or approved reports.
  -- Existing status and original submission/approval metadata are retained.

  for item in select value from jsonb_array_elements(p_entries)
  loop
    item_kind := item ->> 'kind';
    begin
      item_amount := round((item ->> 'amount')::numeric, 2);
    exception when others then
      raise exception 'Every entry needs a valid amount';
    end;
    if item_amount is null or item_amount::text = 'NaN' or item_amount <= 0 then
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

  if report.status = 'draft' then
    update public.daily_reports set status = 'submitted' where id = report.id;
  end if;
  return report.id;
end;
$$;
revoke all on function public.admin_save_staged_report(date, jsonb) from public;
grant execute on function public.admin_save_staged_report(date, jsonb) to authenticated;

commit;
