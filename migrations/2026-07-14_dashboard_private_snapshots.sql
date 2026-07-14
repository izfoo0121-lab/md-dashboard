begin;

create table if not exists public.dashboard_snapshots (
  month text not null,
  generation_id uuid not null,
  generated_at timestamptz not null,
  shared_payload jsonb not null,
  manager_support_payload jsonb not null,
  data_quality jsonb not null default '{}'::jsonb,
  checksum text not null,
  source_version text not null,
  primary key (month, generation_id)
);

create table if not exists public.dashboard_agent_snapshots (
  month text not null,
  generation_id uuid not null,
  agent text not null,
  agent_payload jsonb not null,
  checksum text not null,
  generated_at timestamptz not null,
  primary key (month, generation_id, agent),
  foreign key (month, generation_id)
    references public.dashboard_snapshots(month, generation_id)
    on delete cascade
);

create table if not exists public.dashboard_manager_artifacts (
  month_key text not null,
  generation_id uuid not null,
  artifact_key text not null,
  generated_at timestamptz not null,
  payload jsonb not null,
  checksum text not null,
  primary key (month_key, generation_id, artifact_key),
  foreign key (month_key, generation_id)
    references public.dashboard_snapshots(month, generation_id)
    on delete cascade
);

create table if not exists public.dashboard_active_snapshots (
  month_key text primary key,
  generation_id uuid not null,
  activated_at timestamptz not null default now(),
  shared_checksum text not null,
  agent_count integer not null check (agent_count > 0),
  agent_checksums jsonb not null,
  artifact_checksums jsonb not null,
  foreign key (month_key, generation_id)
    references public.dashboard_snapshots(month, generation_id)
);

create table if not exists public.dashboard_sessions (
  token_hash text primary key,
  agent text not null,
  role text not null check (role in ('agent', 'manager')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz not null default now()
);

create table if not exists public.dashboard_login_attempts (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts >= 0)
);

create index if not exists dashboard_agent_snapshots_agent_month_idx
  on public.dashboard_agent_snapshots(agent, month, generation_id);
create index if not exists dashboard_manager_artifacts_key_idx
  on public.dashboard_manager_artifacts(artifact_key, month_key, generation_id);
create index if not exists dashboard_sessions_expires_idx
  on public.dashboard_sessions(expires_at);

alter table public.dashboard_snapshots enable row level security;
alter table public.dashboard_agent_snapshots enable row level security;
alter table public.dashboard_manager_artifacts enable row level security;
alter table public.dashboard_active_snapshots enable row level security;
alter table public.dashboard_sessions enable row level security;
alter table public.dashboard_login_attempts enable row level security;

revoke all on public.dashboard_snapshots from anon, authenticated;
revoke all on public.dashboard_agent_snapshots from anon, authenticated;
revoke all on public.dashboard_manager_artifacts from anon, authenticated;
revoke all on public.dashboard_active_snapshots from anon, authenticated;
revoke all on public.dashboard_sessions from anon, authenticated;
revoke all on public.dashboard_login_attempts from anon, authenticated;

commit;
