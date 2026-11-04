alter table public.quotations add column workflow_run_id uuid;
alter table public.opportunities add column workflow_run_id uuid;
alter table public.tasks add column workflow_run_id uuid;

alter table public.quotations
  add constraint quotations_workflow_run_unique unique (workflow_run_id),
  add constraint quotations_workflow_run_fk
    foreign key (org_id, workflow_run_id) references public.workflow_runs(org_id, id) on delete set null (workflow_run_id);
alter table public.opportunities
  add constraint opportunities_workflow_run_unique unique (workflow_run_id),
  add constraint opportunities_workflow_run_fk
    foreign key (org_id, workflow_run_id) references public.workflow_runs(org_id, id) on delete set null (workflow_run_id);
alter table public.tasks
  add constraint tasks_workflow_run_unique unique (workflow_run_id),
  add constraint tasks_workflow_run_fk
    foreign key (org_id, workflow_run_id) references public.workflow_runs(org_id, id) on delete set null (workflow_run_id);

create index quotations_workflow_run_idx on public.quotations (workflow_run_id);
create index opportunities_workflow_run_idx on public.opportunities (workflow_run_id);
create index tasks_workflow_run_idx on public.tasks (workflow_run_id);

alter table public.quotation_lines
  add constraint quotation_lines_quotation_product_unique unique (quotation_id, product_id);

alter table public.audit_logs add column event_key text unique;

create or replace function public.record_audit_log_event(
  p_event_key text,
  p_org_id uuid,
  p_actor_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare new_id uuid;
begin
  insert into public.audit_logs (event_key, org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_event_key, p_org_id, p_actor_id, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
  on conflict (event_key) do nothing
  returning id into new_id;
  if new_id is null then select id into new_id from public.audit_logs where event_key = p_event_key; end if;
  return new_id;
end;
$$;

revoke all on function public.record_audit_log_event(text, uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_audit_log_event(text, uuid, uuid, text, text, uuid, jsonb) to service_role;

create table public.ai_model_rates (
  model text primary key,
  input_usd_per_million numeric(12,6) not null check (input_usd_per_million >= 0),
  cached_input_usd_per_million numeric(12,6) not null check (cached_input_usd_per_million >= 0),
  output_usd_per_million numeric(12,6) not null check (output_usd_per_million >= 0),
  pricing_source text not null,
  verified_at date not null,
  active boolean not null default true
);

insert into public.ai_model_rates (model, input_usd_per_million, cached_input_usd_per_million, output_usd_per_million, pricing_source, verified_at)
values
  ('muse-spark-1.3', 1.25, 0.15, 4.25, 'https://dev.meta.ai/docs/pricing-rate-limits', current_date),
  ('muse-spark-1.2', 1.25, 0.15, 4.25, 'https://dev.meta.ai/docs/pricing-rate-limits', current_date),
  ('muse-spark-1.1', 1.25, 0.15, 4.25, 'https://dev.meta.ai/docs/pricing-rate-limits', current_date),
  ('muse-spark-1.3-contributor', 0.10, 0.002, 0.20, 'https://dev.meta.ai/docs/pricing-rate-limits', current_date),
  ('muse-spark-1.2-contributor', 0.10, 0.002, 0.20, 'https://dev.meta.ai/docs/pricing-rate-limits', current_date);

create table public.ai_budget_settings (
  id text primary key default 'global' check (id = 'global'),
  allocation_usd numeric(12,2) not null default 100 check (allocation_usd > 0),
  warning_threshold_usd numeric(12,2) not null default 90 check (warning_threshold_usd > 0),
  hard_limit_usd numeric(12,2) not null default 90 check (hard_limit_usd > 0 and hard_limit_usd <= allocation_usd),
  currency text not null default 'USD' check (currency = 'USD'),
  updated_at timestamptz not null default now()
);

insert into public.ai_budget_settings (id, allocation_usd, warning_threshold_usd, hard_limit_usd)
values ('global', 100, 90, 90);

create table public.ai_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  module text not null check (char_length(trim(module)) between 1 and 80),
  model text not null,
  status text not null check (status in ('reserved', 'completed', 'failed', 'rejected', 'unpriced')),
  estimated_cost_usd numeric(12,6),
  actual_cost_usd numeric(12,6),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  provider_response_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index ai_usage_ledger_created_idx on public.ai_usage_ledger (created_at desc);
create index ai_usage_ledger_org_created_idx on public.ai_usage_ledger (org_id, created_at desc);
create index ai_usage_ledger_status_idx on public.ai_usage_ledger (status, created_at desc);

alter table public.ai_model_rates enable row level security;
alter table public.ai_budget_settings enable row level security;
alter table public.ai_usage_ledger enable row level security;

create policy "members can view their AI usage" on public.ai_usage_ledger
for select to authenticated using (public.is_org_member(org_id));

revoke all on table public.ai_model_rates, public.ai_budget_settings, public.ai_usage_ledger from anon, authenticated;
grant select on table public.ai_usage_ledger to authenticated;
grant all on table public.ai_model_rates, public.ai_budget_settings, public.ai_usage_ledger to service_role;

create or replace function public.reserve_ai_usage(
  p_request_id uuid,
  p_org_id uuid,
  p_actor_id uuid,
  p_module text,
  p_model text,
  p_estimated_cost_usd numeric,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  budget public.ai_budget_settings;
  committed numeric(12,6);
  existing public.ai_usage_ledger;
begin
  select * into budget from public.ai_budget_settings where id = 'global' for update;
  select * into existing from public.ai_usage_ledger where request_id = p_request_id;
  if found then
    return jsonb_build_object('allowed', existing.status in ('reserved', 'completed'), 'status', existing.status, 'request_id', existing.request_id, 'budget_guarded', existing.estimated_cost_usd is not null);
  end if;

  select coalesce(sum(coalesce(actual_cost_usd, estimated_cost_usd, 0)), 0)
    into committed
    from public.ai_usage_ledger
   where status in ('reserved', 'completed', 'unpriced');

  if p_estimated_cost_usd is not null and committed + p_estimated_cost_usd > budget.hard_limit_usd then
    insert into public.ai_usage_ledger (request_id, org_id, actor_id, module, model, status, estimated_cost_usd, metadata)
    values (p_request_id, p_org_id, p_actor_id, p_module, p_model, 'rejected', p_estimated_cost_usd, coalesce(p_metadata, '{}'::jsonb));
    return jsonb_build_object('allowed', false, 'status', 'rejected', 'reason', 'AI application budget limit reached', 'committed_usd', committed, 'hard_limit_usd', budget.hard_limit_usd, 'request_id', p_request_id);
  end if;

  insert into public.ai_usage_ledger (request_id, org_id, actor_id, module, model, status, estimated_cost_usd, metadata)
  values (p_request_id, p_org_id, p_actor_id, p_module, p_model, case when p_estimated_cost_usd is null then 'unpriced' else 'reserved' end, p_estimated_cost_usd, coalesce(p_metadata, '{}'::jsonb));
  return jsonb_build_object('allowed', true, 'status', case when p_estimated_cost_usd is null then 'unpriced' else 'reserved' end, 'budget_guarded', p_estimated_cost_usd is not null, 'committed_usd', committed, 'hard_limit_usd', budget.hard_limit_usd, 'warning_threshold_usd', budget.warning_threshold_usd, 'request_id', p_request_id);
end;
$$;

create or replace function public.reconcile_ai_usage(
  p_request_id uuid,
  p_model text,
  p_input_tokens bigint,
  p_cached_input_tokens bigint,
  p_output_tokens bigint,
  p_total_tokens bigint,
  p_provider_response_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  rate public.ai_model_rates;
  actual numeric(12,6);
begin
  select * into rate from public.ai_model_rates where model = p_model and active;
  if not found then
    update public.ai_usage_ledger set status = 'unpriced', input_tokens = greatest(p_input_tokens, 0), cached_input_tokens = greatest(p_cached_input_tokens, 0), output_tokens = greatest(p_output_tokens, 0), total_tokens = greatest(p_total_tokens, 0), provider_response_id = p_provider_response_id, metadata = coalesce(p_metadata, '{}'::jsonb), completed_at = now() where request_id = p_request_id;
    return jsonb_build_object('status', 'unpriced', 'budget_guarded', false, 'request_id', p_request_id);
  end if;
  actual := ((greatest(p_input_tokens - p_cached_input_tokens, 0) * rate.input_usd_per_million) + (greatest(p_cached_input_tokens, 0) * rate.cached_input_usd_per_million) + (greatest(p_output_tokens, 0) * rate.output_usd_per_million)) / 1000000;
  update public.ai_usage_ledger set status = 'completed', actual_cost_usd = actual, input_tokens = greatest(p_input_tokens, 0), cached_input_tokens = greatest(p_cached_input_tokens, 0), output_tokens = greatest(p_output_tokens, 0), total_tokens = greatest(p_total_tokens, 0), provider_response_id = p_provider_response_id, metadata = coalesce(p_metadata, '{}'::jsonb), completed_at = now() where request_id = p_request_id;
  return jsonb_build_object('status', 'completed', 'budget_guarded', true, 'actual_cost_usd', actual, 'request_id', p_request_id);
end;
$$;

create or replace function public.fail_ai_usage(p_request_id uuid, p_metadata jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = ''
as $$ update public.ai_usage_ledger set status = 'failed', metadata = coalesce(p_metadata, '{}'::jsonb), completed_at = now() where request_id = p_request_id; $$;

revoke all on function public.reserve_ai_usage(uuid, uuid, uuid, text, text, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.reconcile_ai_usage(uuid, text, bigint, bigint, bigint, bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_ai_usage(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid, uuid, uuid, text, text, numeric, jsonb) to service_role;
grant execute on function public.reconcile_ai_usage(uuid, text, bigint, bigint, bigint, bigint, text, jsonb) to service_role;
grant execute on function public.fail_ai_usage(uuid, jsonb) to service_role;
