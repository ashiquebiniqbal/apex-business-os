create table public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 200),
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  sku text not null,
  name text not null,
  unit_price numeric(14,2) not null check (unit_price >= 0),
  tax_rate numeric(6,3) not null default 0 check (tax_rate between 0 and 100),
  stock_qty numeric(14,3) not null default 0 check (stock_qty >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, sku)
);

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid,
  content text not null,
  status text not null default 'new' check (status in ('new','processing','proposal','approved','rejected','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, customer_id) references public.customers(org_id, id) on delete set null (customer_id)
);

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  inquiry_id uuid,
  customer_id uuid,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','sent','accepted','rejected')),
  currency text not null default 'BDT' check (char_length(currency) between 3 and 3),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  tax_total numeric(14,2) not null default 0 check (tax_total >= 0),
  total numeric(14,2) not null default 0 check (total >= 0 and total = subtotal + tax_total),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, inquiry_id) references public.inquiries(org_id, id) on delete set null (inquiry_id),
  foreign key (org_id, customer_id) references public.customers(org_id, id) on delete set null (customer_id)
);

create table public.quotation_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  tax_rate numeric(6,3) not null check (tax_rate between 0 and 100),
  line_total numeric(14,2) not null check (line_total >= 0),
  foreign key (org_id, quotation_id) references public.quotations(org_id, id) on delete cascade,
  foreign key (org_id, product_id) references public.products(org_id, id) on delete restrict
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid,
  inquiry_id uuid,
  title text not null,
  status text not null default 'proposed' check (status in ('proposed','open','won','lost')),
  estimated_value numeric(14,2) not null default 0 check (estimated_value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, customer_id) references public.customers(org_id, id) on delete set null (customer_id),
  foreign key (org_id, inquiry_id) references public.inquiries(org_id, id) on delete set null (inquiry_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid,
  inquiry_id uuid,
  title text not null,
  status text not null default 'open' check (status in ('open','done','dismissed')),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, customer_id) references public.customers(org_id, id) on delete set null (customer_id),
  foreign key (org_id, inquiry_id) references public.inquiries(org_id, id) on delete set null (inquiry_id)
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  inquiry_id uuid,
  status text not null check (status in ('proposed','approved','executed','failed')),
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, inquiry_id) references public.inquiries(org_id, id) on delete set null (inquiry_id)
);

create index customers_org_created_idx on public.customers (org_id, created_at desc);
create index products_org_active_idx on public.products (org_id, active, name);
create index inquiries_org_status_idx on public.inquiries (org_id, status, created_at desc);
create index inquiries_customer_idx on public.inquiries (org_id, customer_id);
create index quotations_org_status_idx on public.quotations (org_id, status, created_at desc);
create index quotations_customer_idx on public.quotations (org_id, customer_id);
create index quotation_lines_quotation_idx on public.quotation_lines (org_id, quotation_id);
create index quotation_lines_product_idx on public.quotation_lines (org_id, product_id);
create index opportunities_org_status_idx on public.opportunities (org_id, status, created_at desc);
create index tasks_org_status_idx on public.tasks (org_id, status, due_at);
create index workflow_runs_org_status_idx on public.workflow_runs (org_id, status, created_at desc);

create or replace function public.prevent_org_id_change()
returns trigger language plpgsql set search_path = ''
as $$ begin
  if new.org_id <> old.org_id then raise exception 'Organization ownership cannot be changed'; end if;
  return new;
end; $$;

create or replace function public.prevent_created_by_change()
returns trigger language plpgsql set search_path = ''
as $$ begin
  if new.created_by <> old.created_by then raise exception 'Record creator cannot be changed'; end if;
  return new;
end; $$;

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
  new.line_total = round(new.quantity * new.unit_price, 2);
  return new;
end;
$$;

create or replace function public.recalculate_quotation_totals(target_quotation uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare new_subtotal numeric(14,2); new_tax_total numeric(14,2);
begin
  select coalesce(round(sum(quantity * unit_price), 2), 0)::numeric(14,2),
         coalesce(round(sum(quantity * unit_price * tax_rate / 100), 2), 0)::numeric(14,2)
    into new_subtotal, new_tax_total
    from public.quotation_lines where quotation_id = target_quotation;
  update public.quotations
     set subtotal = new_subtotal, tax_total = new_tax_total, total = (new_subtotal + new_tax_total)::numeric(14,2)
   where id = target_quotation;
end;
$$;

create or replace function public.recalculate_quotation_totals_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  if tg_op = 'DELETE' then
    perform public.recalculate_quotation_totals(old.quotation_id);
  else
    perform public.recalculate_quotation_totals(new.quotation_id);
  end if;
  return coalesce(new, old);
end; $$;

create or replace function public.prevent_direct_quotation_amount_change()
returns trigger language plpgsql set search_path = ''
as $$
declare expected_subtotal numeric(14,2); expected_tax numeric(14,2);
begin
  if tg_op = 'INSERT' and new.status not in ('draft', 'pending_approval') then
    raise exception 'New quotations must begin as draft or pending approval';
  end if;
  select coalesce(round(sum(quantity * unit_price), 2), 0)::numeric(14,2),
         coalesce(round(sum(quantity * unit_price * tax_rate / 100), 2), 0)::numeric(14,2)
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

create trigger customers_updated before update on public.customers for each row execute function public.set_updated_at();
create trigger products_updated before update on public.products for each row execute function public.set_updated_at();
create trigger inquiries_updated before update on public.inquiries for each row execute function public.set_updated_at();
create trigger quotations_updated before update on public.quotations for each row execute function public.set_updated_at();
create trigger opportunities_updated before update on public.opportunities for each row execute function public.set_updated_at();
create trigger tasks_updated before update on public.tasks for each row execute function public.set_updated_at();
create trigger workflow_runs_updated before update on public.workflow_runs for each row execute function public.set_updated_at();
create trigger customers_org_immutable before update on public.customers for each row execute function public.prevent_org_id_change();
create trigger products_org_immutable before update on public.products for each row execute function public.prevent_org_id_change();
create trigger inquiries_org_immutable before update on public.inquiries for each row execute function public.prevent_org_id_change();
create trigger quotations_org_immutable before update on public.quotations for each row execute function public.prevent_org_id_change();
create trigger opportunities_org_immutable before update on public.opportunities for each row execute function public.prevent_org_id_change();
create trigger tasks_org_immutable before update on public.tasks for each row execute function public.prevent_org_id_change();
create trigger workflow_runs_org_immutable before update on public.workflow_runs for each row execute function public.prevent_org_id_change();
create trigger workflow_runs_creator_immutable before update on public.workflow_runs for each row execute function public.prevent_created_by_change();
create trigger quotations_amounts_guard before insert or update on public.quotations for each row execute function public.prevent_direct_quotation_amount_change();
create trigger quotation_lines_validate before insert or update on public.quotation_lines for each row execute function public.validate_quotation_line();
create trigger quotation_lines_recalculate after insert or update or delete on public.quotation_lines for each row execute function public.recalculate_quotation_totals_trigger();

alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.inquiries enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_lines enable row level security;
alter table public.opportunities enable row level security;
alter table public.tasks enable row level security;
alter table public.workflow_runs enable row level security;

create policy "members can read customers" on public.customers for select to authenticated using (public.is_org_member(org_id));
create policy "operators can insert customers" on public.customers for insert to authenticated with check (public.has_org_role(org_id, array['owner','admin','manager','staff']::public.org_role[]));
create policy "operators can update customers" on public.customers for update to authenticated using (public.has_org_role(org_id, array['owner','admin','manager','staff']::public.org_role[])) with check (public.has_org_role(org_id, array['owner','admin','manager','staff']::public.org_role[]));
create policy "managers can delete customers" on public.customers for delete to authenticated using (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "members can read products" on public.products for select to authenticated using (public.is_org_member(org_id));
create policy "managers can insert products" on public.products for insert to authenticated with check (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "managers can update products" on public.products for update to authenticated using (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[])) with check (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "managers can delete products" on public.products for delete to authenticated using (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "members can read inquiries" on public.inquiries for select to authenticated using (public.is_org_member(org_id));
create policy "operators can insert inquiries" on public.inquiries for insert to authenticated with check (public.has_org_role(org_id, array['owner','admin','manager','staff']::public.org_role[]));
create policy "operators can update inquiries" on public.inquiries for update to authenticated using (public.has_org_role(org_id, array['owner','admin','manager','staff']::public.org_role[])) with check (public.has_org_role(org_id, array['owner','admin','manager','staff']::public.org_role[]));
create policy "managers can delete inquiries" on public.inquiries for delete to authenticated using (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "members can read quotations" on public.quotations for select to authenticated using (public.is_org_member(org_id));
create policy "managers can insert quotations" on public.quotations for insert to authenticated with check (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "managers can update quotations" on public.quotations for update to authenticated using (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[])) with check (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "managers can delete quotations" on public.quotations for delete to authenticated using (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "members can read quotation lines" on public.quotation_lines for select to authenticated using (public.is_org_member(org_id));
create policy "managers can insert quotation lines" on public.quotation_lines for insert to authenticated with check (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "managers can update quotation lines" on public.quotation_lines for update to authenticated using (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[])) with check (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "managers can delete quotation lines" on public.quotation_lines for delete to authenticated using (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "members can read opportunities" on public.opportunities for select to authenticated using (public.is_org_member(org_id));
create policy "managers can insert opportunities" on public.opportunities for insert to authenticated with check (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "managers can update opportunities" on public.opportunities for update to authenticated using (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[])) with check (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "managers can delete opportunities" on public.opportunities for delete to authenticated using (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "members can read tasks" on public.tasks for select to authenticated using (public.is_org_member(org_id));
create policy "operators can insert tasks" on public.tasks for insert to authenticated with check (public.has_org_role(org_id, array['owner','admin','manager','staff']::public.org_role[]));
create policy "operators can update tasks" on public.tasks for update to authenticated using (public.has_org_role(org_id, array['owner','admin','manager','staff']::public.org_role[])) with check (public.has_org_role(org_id, array['owner','admin','manager','staff']::public.org_role[]));
create policy "managers can delete tasks" on public.tasks for delete to authenticated using (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "members can read workflow runs" on public.workflow_runs for select to authenticated using (public.is_org_member(org_id));
create policy "operators can insert workflow runs" on public.workflow_runs for insert to authenticated with check (created_by = (select auth.uid()) and public.has_org_role(org_id, array['owner','admin','manager','staff']::public.org_role[]));
create policy "managers can update workflow runs" on public.workflow_runs for update to authenticated using (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[])) with check (public.has_org_role(org_id, array['owner','admin','manager']::public.org_role[]));
create policy "admins can delete workflow runs" on public.workflow_runs for delete to authenticated using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

revoke all on table public.customers, public.products, public.inquiries, public.quotations, public.quotation_lines, public.opportunities, public.tasks, public.workflow_runs from anon, authenticated;
grant select, insert, update, delete on table public.customers, public.products, public.inquiries, public.quotations, public.quotation_lines, public.opportunities, public.tasks, public.workflow_runs to authenticated;
revoke all on function public.prevent_org_id_change() from public, anon, authenticated;
revoke all on function public.prevent_created_by_change() from public, anon, authenticated;
revoke all on function public.validate_quotation_line() from public, anon, authenticated;
revoke all on function public.recalculate_quotation_totals(uuid) from public, anon, authenticated;
revoke all on function public.recalculate_quotation_totals_trigger() from public, anon, authenticated;
revoke all on function public.prevent_direct_quotation_amount_change() from public, anon, authenticated;
