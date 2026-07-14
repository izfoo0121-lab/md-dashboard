begin;

create table if not exists public.dashboard_snapshots (
  month text primary key,
  generated_at timestamptz not null,
  shared_payload jsonb not null,
  manager_support_payload jsonb not null,
  data_quality jsonb not null default '{}'::jsonb,
  checksum text not null,
  source_version text not null
);

create table if not exists public.dashboard_agent_snapshots (
  month text not null references public.dashboard_snapshots(month) on delete cascade,
  agent text not null,
  agent_payload jsonb not null,
  checksum text not null,
  generated_at timestamptz not null,
  primary key (month, agent)
);

create table if not exists public.dashboard_manager_artifacts (
  artifact_key text primary key,
  generated_at timestamptz not null,
  payload jsonb not null,
  checksum text not null
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
  failures integer not null check (failures >= 0)
);

create index if not exists dashboard_agent_snapshots_agent_month_idx
  on public.dashboard_agent_snapshots(agent, month);
create index if not exists dashboard_sessions_expires_idx
  on public.dashboard_sessions(expires_at);

alter table public.dashboard_snapshots enable row level security;
alter table public.dashboard_agent_snapshots enable row level security;
alter table public.dashboard_manager_artifacts enable row level security;
alter table public.dashboard_sessions enable row level security;
alter table public.dashboard_login_attempts enable row level security;

revoke all on public.dashboard_snapshots from anon, authenticated;
revoke all on public.dashboard_agent_snapshots from anon, authenticated;
revoke all on public.dashboard_manager_artifacts from anon, authenticated;
revoke all on public.dashboard_sessions from anon, authenticated;
revoke all on public.dashboard_login_attempts from anon, authenticated;

commit;
