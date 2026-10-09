begin;

-- Keep daily_reports.cash_in_hand as the day's net cash movement. Derive the
-- running closing balance so corrections to older reports carry forward.
create view public.daily_cash_balances with (security_invoker = true) as
select r.id, r.business_date, r.status, r.cash_sales as total_sales,
  r.cash_in_hand as daily_cash_change,
  sum(coalesce(r.cash_in_hand, 0)) over (
    order by r.business_date rows between unbounded preceding and current row
  ) as cash_in_hand
from public.daily_reports r
where r.status in ('submitted', 'approved');

grant select on public.daily_cash_balances to authenticated;

-- Apply the date filter after calculating the running balance. Totals span
-- every matching day, independently of the page currently being displayed.
create function public.cash_sales_history_totals(p_business_date date default null)
returns table (report_count bigint, total_sales numeric, cash_in_hand numeric)
language sql stable set search_path = pg_catalog, public
as $$
  select count(*), coalesce(sum(b.total_sales), 0),
    coalesce((array_agg(b.cash_in_hand order by b.business_date desc))[1], 0)
  from public.daily_cash_balances b
  where b.business_date <= public.current_business_date()
    and (p_business_date is null or b.business_date = p_business_date);
$$;

revoke all on function public.cash_sales_history_totals(date) from public;
grant execute on function public.cash_sales_history_totals(date) to authenticated;

-- Rename legacy default display names without touching logins or roles.
update public.profiles
set full_name = regexp_replace(full_name, '\mstorekeeper\M', 'User', 'gi')
where full_name ~* '\mstorekeeper\M';

commit;
