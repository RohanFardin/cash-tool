begin;

-- Update the company's contact and save its new entries atomically. Earlier
-- ledger entries retain the phone number supplied at the time of their entry.
drop function public.admin_add_purchase_payment(bigint, date, numeric, numeric);

create function public.admin_add_purchase_payment(
  p_supplier_id bigint, p_business_date date,
  p_purchase numeric default null, p_payment numeric default null,
  p_phone_number text default null
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
  if (purchase is null and payment is null and p_phone_number is null)
    or (purchase is not null and (purchase::text = 'NaN' or purchase <= 0))
    or (payment is not null and (payment::text = 'NaN' or payment <= 0)) then
    raise exception 'Enter a purchase or payment amount greater than zero, or update the phone number';
  end if;
  if length(btrim(p_phone_number)) > 30 then
    raise exception 'Phone numbers must be 30 characters or fewer';
  end if;

  select phone_number into phone from public.suppliers
  where id = p_supplier_id for update;
  if not found then raise exception 'Select a company'; end if;
  -- An omitted argument keeps the saved number for older callers. An explicit
  -- blank clears it. Only the selected company's current contact is changed.
  if p_phone_number is not null then
    phone := nullif(btrim(p_phone_number), '');
    update public.suppliers set phone_number = phone
    where id = p_supplier_id and phone_number is distinct from phone;
  end if;

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

revoke all on function public.admin_add_purchase_payment(bigint, date, numeric, numeric, text) from public;
grant execute on function public.admin_add_purchase_payment(bigint, date, numeric, numeric, text) to authenticated;

notify pgrst, 'reload schema';
commit;
