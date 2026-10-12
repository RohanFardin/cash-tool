begin;

-- Delete one selected report as a single transaction. Directory records and
-- other report dates remain available, and the balance views recalculate.
create function public.admin_delete_daily_report(p_report_id bigint, p_business_date date)
returns bigint
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  report public.daily_reports%rowtype;
begin
  if auth.uid() is null or not coalesce(public.is_superadmin(), false) then
    raise exception 'Administrator access required';
  end if;
  if p_report_id is null or p_report_id <= 0 or p_business_date is null
    or p_business_date > public.current_business_date() then
    raise exception 'Select a valid report date';
  end if;

  -- Matching both the id and date prevents a stale confirmation from deleting
  -- a replacement report. Entry inserts also take this report lock.
  select * into report from public.daily_reports
  where id = p_report_id and business_date = p_business_date
    and status in ('submitted', 'approved')
  for update;
  if not found then raise exception 'Submitted report is not available'; end if;

  delete from public.customer_ledger_entries where daily_report_id = report.id;
  delete from public.supplier_ledger_entries where daily_report_id = report.id;
  delete from public.transactions where daily_report_id = report.id;
  -- Remove negative adjustments first so the cash-total sync trigger cannot
  -- temporarily push a nonnegative daily total below zero during deletion.
  delete from public.cash_sales_entries where daily_report_id = report.id and amount < 0;
  delete from public.cash_sales_entries where daily_report_id = report.id;
  delete from public.daily_reports where id = report.id;
  return report.id;
end;
$$;

revoke all on function public.admin_delete_daily_report(bigint, date) from public;
grant execute on function public.admin_delete_daily_report(bigint, date) to authenticated;

commit;
