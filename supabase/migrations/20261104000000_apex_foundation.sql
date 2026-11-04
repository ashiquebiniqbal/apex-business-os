create extension if not exists "pgcrypto";

create type public.org_role as enum ('owner', 'admin', 'manager', 'staff', 'viewer');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  active_org_id uuid references public.organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(trim(action)) between 1 and 120),
  entity_type text not null check (char_length(trim(entity_type)) between 1 and 120),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index org_members_user_idx on public.org_members (user_id, org_id);
create index audit_logs_org_created_idx on public.audit_logs (org_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.org_members where org_id = target_org and user_id = (select auth.uid()));
$$;

create or replace function public.has_org_role(target_org uuid, allowed_roles public.org_role[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.org_members where org_id = target_org and user_id = (select auth.uid()) and role = any(allowed_roles));
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

create or replace function public.provision_org_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.created_by <> (select auth.uid()) then
    raise exception 'Organization creator must be the authenticated user';
  end if;
  insert into public.org_members (org_id, user_id, role) values (new.id, new.created_by, 'owner');
  update public.profiles set active_org_id = new.id where id = new.created_by and active_org_id is null;
  return new;
end;
$$;

create or replace function public.prevent_org_creator_change()
returns trigger language plpgsql set search_path = ''
as $$ begin
  if new.created_by <> old.created_by then raise exception 'Organization creator cannot be changed'; end if;
  return new;
end; $$;

create or replace function public.prevent_last_org_owner_change()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.role = 'owner'
     and not exists (select 1 from public.org_members where org_id = old.org_id and role = 'owner' and user_id <> old.user_id) then
    raise exception 'An organization must retain at least one owner';
  end if;
  if tg_op = 'UPDATE' and old.role = 'owner' and (new.role <> 'owner' or new.org_id <> old.org_id)
     and not exists (select 1 from public.org_members where org_id = old.org_id and role = 'owner' and user_id <> old.user_id) then
    raise exception 'An organization must retain at least one owner';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.prevent_membership_identity_change()
returns trigger language plpgsql set search_path = ''
as $$ begin
  if new.org_id <> old.org_id or new.user_id <> old.user_id then
    raise exception 'Membership organization and user cannot be changed';
  end if;
  return new;
end; $$;

create or replace function public.prevent_audit_log_mutation()
returns trigger language plpgsql set search_path = ''
as $$ begin raise exception 'Audit logs are append-only'; end; $$;

create or replace function public.record_audit_log(
  p_org_id uuid, p_actor_id uuid, p_action text, p_entity_type text,
  p_entity_id uuid default null, p_metadata jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare new_id uuid;
begin
  insert into public.audit_logs (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org_id, p_actor_id, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into new_id;
  return new_id;
end;
$$;

create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger organizations_updated before update on public.organizations for each row execute function public.set_updated_at();
create trigger auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create trigger organization_owner_provisioned after insert on public.organizations for each row execute function public.provision_org_owner();
create trigger organization_creator_immutable before update on public.organizations for each row execute function public.prevent_org_creator_change();
create trigger org_member_owner_guard before update or delete on public.org_members for each row execute function public.prevent_last_org_owner_change();
create trigger org_member_identity_immutable before update on public.org_members for each row execute function public.prevent_membership_identity_change();
create trigger audit_log_append_only before update or delete on public.audit_logs for each row execute function public.prevent_audit_log_mutation();

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.profiles enable row level security;
alter table public.audit_logs enable row level security;

create policy "members can view their organizations" on public.organizations for select to authenticated using (public.is_org_member(id));
create policy "authenticated users can create organizations" on public.organizations for insert to authenticated with check (created_by = (select auth.uid()));
create policy "organization admins can update organizations" on public.organizations for update to authenticated
using (public.has_org_role(id, array['owner','admin']::public.org_role[]))
with check (public.has_org_role(id, array['owner','admin']::public.org_role[]));

create policy "members can view memberships" on public.org_members for select to authenticated using (public.is_org_member(org_id));
create policy "owners can add memberships" on public.org_members for insert to authenticated with check (public.has_org_role(org_id, array['owner']::public.org_role[]));
create policy "admins can add non-owner memberships" on public.org_members for insert to authenticated with check (role <> 'owner' and public.has_org_role(org_id, array['admin']::public.org_role[]));
create policy "owners can update memberships" on public.org_members for update to authenticated
using (public.has_org_role(org_id, array['owner']::public.org_role[]))
with check (public.has_org_role(org_id, array['owner']::public.org_role[]));
create policy "admins can update non-owner memberships" on public.org_members for update to authenticated
using (role <> 'owner' and public.has_org_role(org_id, array['admin']::public.org_role[]))
with check (role <> 'owner' and public.has_org_role(org_id, array['admin']::public.org_role[]));
create policy "owners can delete memberships" on public.org_members for delete to authenticated using (public.has_org_role(org_id, array['owner']::public.org_role[]));
create policy "admins can delete non-owner memberships" on public.org_members for delete to authenticated using (role <> 'owner' and public.has_org_role(org_id, array['admin']::public.org_role[]));

create policy "users can view their profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "users can update their profile" on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()) and (active_org_id is null or public.is_org_member(active_org_id)));
create policy "members can view audit logs" on public.audit_logs for select to authenticated using (public.is_org_member(org_id));

revoke all on table public.organizations, public.org_members, public.profiles, public.audit_logs from anon, authenticated;
grant select, insert, update on table public.organizations to authenticated;
grant select, insert, update, delete on table public.org_members to authenticated;
grant select, update on table public.profiles to authenticated;
grant select on table public.audit_logs to authenticated;
grant insert on table public.audit_logs to service_role;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_org_role(uuid, public.org_role[]) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;
revoke all on function public.record_audit_log(uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_audit_log(uuid, uuid, text, text, uuid, jsonb) to service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.provision_org_owner() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.prevent_org_creator_change() from public, anon, authenticated;
revoke all on function public.prevent_last_org_owner_change() from public, anon, authenticated;
revoke all on function public.prevent_membership_identity_change() from public, anon, authenticated;
revoke all on function public.prevent_audit_log_mutation() from public, anon, authenticated;
