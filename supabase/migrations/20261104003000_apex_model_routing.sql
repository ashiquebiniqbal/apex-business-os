create table public.ai_model_routing_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  mode text not null default 'auto' check (mode in ('auto', 'manual')),
  manual_model text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((mode = 'auto' and manual_model is null) or (mode = 'manual' and manual_model is not null))
);

alter table public.ai_model_routing_settings enable row level security;

create policy "members can view routing settings"
on public.ai_model_routing_settings
for select to authenticated
using (public.is_org_member(org_id));

revoke all on table public.ai_model_routing_settings from anon, authenticated;
grant select on table public.ai_model_routing_settings to authenticated;
grant all on table public.ai_model_routing_settings to service_role;

create index ai_model_routing_settings_updated_idx
on public.ai_model_routing_settings (updated_at desc);
