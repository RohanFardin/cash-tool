begin;

alter table public.profiles
  add column entry_editing_enabled boolean not null default false;

-- The setting applies to corrections of saved entries. Adding missing entries
-- and deleting a complete report keep their existing administrator permissions.
create function public.guard_admin_entry_editing()
returns trigger language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if coalesce(public.is_superadmin(), false) and not exists (
    select 1 from public.profiles
    where id = auth.uid() and entry_editing_enabled
  ) then
    raise exception 'Enable entry editing in Settings before changing saved entries';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_admin_entry_editing() from public;

create trigger admin_entry_edit_mode before update on public.cash_sales_entries
for each row execute function public.guard_admin_entry_editing();
create trigger admin_entry_edit_mode before update on public.customer_ledger_entries
for each row execute function public.guard_admin_entry_editing();
create trigger admin_entry_edit_mode before update on public.supplier_ledger_entries
for each row execute function public.guard_admin_entry_editing();
create trigger admin_entry_edit_mode before update on public.transactions
for each row execute function public.guard_admin_entry_editing();

commit;
