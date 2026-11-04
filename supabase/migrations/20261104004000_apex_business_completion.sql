-- Apex Business OS: business completion (suppliers, organization settings, extended fields, discounts).
-- REVIEW REQUIRED: present this migration and obtain explicit approval before applying to any remote project.
-- Additive only: new tables, new nullable/defaulted columns, and replaced calculation functions.
-- No existing data is modified; no policies are removed.

-- ---------------------------------------------------------------- suppliers
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 200),
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);

create index suppliers_org_created_idx on public.suppliers (org_id, created_at desc);

-- ------------------------------------------------------- organization settings
create table public.organization_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  company_name text check (company_name is null or char_length(company_name) between 1 and 200),
  logo_url text,
  description text,
  industry text,
  website text,
  business_email text,
  phone text,
  address text,
  country text,
  time_zone text,
  default_currency text not null default 'BDT' check (char_length(default_currency) = 3),
  default_tax_rate numeric(6,3) not null default 0 check (default_tax_rate between 0 and 100),
  tax_registration text,
  quotation_validity_days integer not null default 30 check (quotation_validity_days between 1 and 365),
  default_payment_terms text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------- extended columns
alter table public.customers
  add column customer_type text not null default 'company' check (customer_type in ('individual','company')),
  add column address text,
  add column notes text;

alter table public.products
  add column kind text not null default 'product' check (kind in ('product','service')),
  add column category text,
  add column unit text,
  add column cost_price numeric(14,2) check (cost_price is null or cost_price >= 0),
  add column min_stock_level numeric(14,3) check (min_stock_level is null or min_stock_level >= 0);

alter table public.inquiries
  add column assigned_to uuid;

alter table public.quotation_lines
  add column discount_rate numeric(6,3) not null default 0 check (discount_rate between 0 and 100);

alter table public.opportunities
  add column expected_close_date date,
  add column notes text;

alter table public.tasks
  add column assigned_to uuid,
  add column priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  add column opportunity_id uuid,
  add column notes text,
  add constraint tasks_opportunity_fk foreign key (org_id, opportunity_id)
    references public.opportunities(org_id, id) on delete set null (opportunity_id);

create index tasks_opportunity_idx on public.tasks (org_id, opportunity_id);

-- ------------------------------------------------- discount-aware totals
-- Line total is the discounted extended price; tax applies after the discount.
-- unit_price and tax_rate remain immutable product snapshots; quantity and
-- discount_rate stay editable until the quotation is approved, sent, or accepted.
create or replace function public.validate_quotation_line()
returns trigger language plpgsql set search_path = ''
as $$
declare quotation_status text; product_price numeric(14,2); product_tax numeric(6,3);
begin
  select status into quotation_status from public.quotations where org_id = new.org_id and id = new.quotation_id;
  if quotation_status in ('approved', 'sent', 'accepted') then raise exception 'Approved quotations cannot be changed'; end if;
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.quotation_id <> old.quotation_id or new.product_id <> old.product_id or new.unit_price <> old.unit_price or new.tax_rate <> old.tax_rate) then
    raise exception 'Quotation line identity and historical price are immutable';
  end if;
  if tg_op = 'INSERT' then
    select unit_price, tax_rate into product_price, product_tax from public.products where org_id = new.org_id and id = new.product_id;
    if not found then raise exception 'Product does not belong to the quotation organization'; end if;
    new.unit_price = product_price;
    new.tax_rate = product_tax;
  end if;
  new.line_total = round(new.quantity * new.unit_price * (1 - new.discount_rate / 100), 2);
  return new;
end;
$$;

create or replace function public.recalculate_quotation_totals(target_quotation uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare new_subtotal numeric(14,2); new_tax_total numeric(14,2);
begin
  select coalesce(round(sum(line_total), 2), 0)::numeric(14,2),
         coalesce(round(sum(line_total * tax_rate / 100), 2), 0)::numeric(14,2)
    into new_subtotal, new_tax_total
    from public.quotation_lines where quotation_id = target_quotation;
  update public.quotations
     set subtotal = new_subtotal, tax_total = new_tax_total, total = (new_subtotal + new_tax_total)::numeric(14,2)
   where id = target_quotation;
end;
$$;

create or replace function public.prevent_direct_quotation_amount_change()
returns trigger language plpgsql set search_path = ''
as $$
declare expected_subtotal numeric(14,2); expected_tax numeric(14,2);
begin
  if tg_op = 'INSERT' and new.status not in ('draft', 'pending_approval') then
    raise exception 'New quotations must begin as draft or pending approval';
  end if;
  select coalesce(round(sum(line_total), 2), 0)::numeric(14,2),
         coalesce(round(sum(line_total * tax_rate / 100), 2), 0)::numeric(14,2)
    into expected_subtotal, expected_tax
    from public.quotation_lines where quotation_id = new.id;
  if new.subtotal <> expected_subtotal or new.tax_total <> expected_tax or new.total <> expected_subtotal + expected_tax then
    raise exception 'Quotation amounts are calculated from quotation lines';
  end if;
  if tg_op = 'UPDATE' then
    if new.status in ('approved', 'sent', 'accepted') and not exists (select 1 from public.quotation_lines where quotation_id = new.id) then
      raise exception 'A quotation must contain a line before approval';
    end if;
    if old.status in ('approved', 'sent', 'accepted') and
       (new.subtotal <> old.subtotal or new.tax_total <> old.tax_total or new.total <> old.total) then
      raise exception 'Approved quotation amounts are immutable';
    end if;
  end if;
  return new;
end;
$$;

-- Existing triggers (suppliers updated_at + org immutability) follow the established pattern.
create trigger suppliers_updated before update on public.suppliers for each row execute function public.set_updated_at();
create trigger suppliers_org_immutable before update on public.suppliers for each row execute function public.prevent_org_id_change();
create trigger organization_settings_updated before update on public.organization_settings for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------- RLS
alter table public.suppliers enable row level security;
alter table public.organization_settings enable row level security;

create policy "members can read suppliers" on public.suppliers for select to authenticated using (public.is_org_member(org_id));
create policy "operators can insert suppliers" on public.suppliers for insert to authenticated with check (public.has_org_role(org_id, array['owner','admin','manager','staff']::public.org_role[]));
create policy "operators can update suppliers" on public.suppliers for update to authenticated using (public.has_org_role(org_id, array['owner','admin','manager','staff']::public.org_role[])) with check (public.has_org_role(org_id, array['owner','admin','manager','staff']::public.org_role[]));
create policy "managers can delete suppliers" on public.suppliers for delete to authenticated using (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));

create policy "members can read organization settings" on public.organization_settings for select to authenticated using (public.is_org_member(org_id));
create policy "admins can insert organization settings" on public.organization_settings for insert to authenticated with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy "admins can update organization settings" on public.organization_settings for update to authenticated using (public.has_org_role(org_id, array['owner','admin']::public.org_role[])) with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy "admins can delete organization settings" on public.organization_settings for delete to authenticated using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- Members can see display names of people who share an organization, so task and
-- inquiry assignment shows names instead of raw user IDs. Auth identities stay private.
create policy "members can read organization profiles" on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or exists (
    select 1 from public.org_members mine
    join public.org_members theirs on theirs.org_id = mine.org_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
  )
);

revoke all on table public.suppliers, public.organization_settings from anon, authenticated;
grant select, insert, update, delete on table public.suppliers, public.organization_settings to authenticated;
