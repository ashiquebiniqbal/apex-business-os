-- Apex Business OS: Agent OS persistence (agent runs, instructions, providers, integrations).
-- REVIEW REQUIRED: present this migration and obtain explicit approval before applying remotely.
-- Not applied by the hackathon frontend. The MVP works without it via RLS business tools
-- and browser-local run history; this migration enables server-persisted, cross-device state.
-- Secrets are NEVER stored here: only server-secret references (env/secret names).

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null check (char_length(prompt) between 1 and 5000),
  agents text[] not null default '{}',
  provider text,
  model text,
  status text not null default 'pending' check (status in ('pending','planning','running','awaiting_approval','completed','failed','cancelled')),
  steps jsonb not null default '[]'::jsonb,
  approvals jsonb not null default '[]'::jsonb,
  result text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_runs_org_created_idx on public.agent_runs (org_id, created_at desc);

create table public.agent_instructions (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  tone text, approval_preference text, quotation_terms text,
  operational_policies text, sales_follow_up_rules text,
  per_agent jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- credential_ref is a secret NAME (e.g. OPENAI_COMPATIBLE_API_KEY), never a key value.
create table public.provider_registrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  kind text not null check (kind in ('meta','openai-compatible','anthropic','gemini','openrouter','ollama')),
  base_url text not null,
  default_model text,
  credential_ref text not null check (credential_ref ~ '^[A-Z][A-Z0-9_]{2,}$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table public.integration_registrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  kind text not null check (kind in ('custom-http','mcp-http','native')),
  endpoint text not null,
  auth_type text not null default 'bearer-credential-ref',
  credential_ref text check (credential_ref is null or credential_ref ~ '^[A-Z][A-Z0-9_]{2,}$'),
  description text,
  operations jsonb not null default '[]'::jsonb,
  approved_tools jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create trigger agent_runs_updated before update on public.agent_runs for each row execute function public.set_updated_at();
create trigger agent_instructions_updated before update on public.agent_instructions for each row execute function public.set_updated_at();

alter table public.agent_runs enable row level security;
alter table public.agent_instructions enable row level security;
alter table public.provider_registrations enable row level security;
alter table public.integration_registrations enable row level security;

create policy "members can read agent runs" on public.agent_runs for select to authenticated using (public.is_org_member(org_id));
create policy "operators can insert agent runs" on public.agent_runs for insert to authenticated with check (actor_id = (select auth.uid()) and public.has_org_role(org_id, array['owner','admin','manager','staff']::public.org_role[]));
create policy "operators can update agent runs" on public.agent_runs for update to authenticated using (actor_id = (select auth.uid()) and public.is_org_member(org_id)) with check (actor_id = (select auth.uid()) and public.is_org_member(org_id));

create policy "members can read agent instructions" on public.agent_instructions for select to authenticated using (public.is_org_member(org_id));
create policy "admins can write agent instructions" on public.agent_instructions for insert to authenticated with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy "admins can update agent instructions" on public.agent_instructions for update to authenticated using (public.has_org_role(org_id, array['owner','admin']::public.org_role[])) with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- Registrations contain no secrets, but writes stay admin-only; execution stays server-side.
create policy "members can read provider registrations" on public.provider_registrations for select to authenticated using (public.is_org_member(org_id));
create policy "admins can write provider registrations" on public.provider_registrations for insert to authenticated with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy "admins can update provider registrations" on public.provider_registrations for update to authenticated using (public.has_org_role(org_id, array['owner','admin']::public.org_role[])) with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy "admins can delete provider registrations" on public.provider_registrations for delete to authenticated using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

create policy "members can read integration registrations" on public.integration_registrations for select to authenticated using (public.is_org_member(org_id));
create policy "admins can write integration registrations" on public.integration_registrations for insert to authenticated with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy "admins can update integration registrations" on public.integration_registrations for update to authenticated using (public.has_org_role(org_id, array['owner','admin']::public.org_role[])) with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy "admins can delete integration registrations" on public.integration_registrations for delete to authenticated using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

revoke all on table public.agent_runs, public.agent_instructions, public.provider_registrations, public.integration_registrations from anon, authenticated;
grant select, insert, update on table public.agent_runs to authenticated;
grant select, insert, update on table public.agent_instructions to authenticated;
grant select, insert, update, delete on table public.provider_registrations, public.integration_registrations to authenticated;
