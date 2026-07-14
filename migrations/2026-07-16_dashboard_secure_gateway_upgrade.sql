begin;

alter table public.dashboard_snapshots
  add column if not exists generation_id uuid;
alter table public.dashboard_agent_snapshots
  add column if not exists generation_id uuid;
alter table public.dashboard_manager_artifacts
  add column if not exists month_key text;
alter table public.dashboard_manager_artifacts
  add column if not exists generation_id uuid;

update public.dashboard_snapshots
set generation_id = md5('dashboard-snapshot-generation:' || month)::uuid
where generation_id is null;

update public.dashboard_agent_snapshots as agent_snapshot
set generation_id = shared_snapshot.generation_id
from public.dashboard_snapshots as shared_snapshot
where agent_snapshot.generation_id is null
  and shared_snapshot.month = agent_snapshot.month;

update public.dashboard_manager_artifacts
set month_key = nullif(btrim(payload ->> 'current_month'), '')
where month_key is null;

with only_snapshot_month as (
  select min(month) as month
  from public.dashboard_snapshots
  having count(distinct month) = 1
)
update public.dashboard_manager_artifacts as artifact
set month_key = only_snapshot_month.month
from only_snapshot_month
where artifact.month_key is null;

update public.dashboard_manager_artifacts as artifact
set generation_id = shared_snapshot.generation_id
from public.dashboard_snapshots as shared_snapshot
where artifact.generation_id is null
  and shared_snapshot.month = artifact.month_key;

do $$
begin
  if exists (
    select 1
    from public.dashboard_snapshots
    where generation_id is null
  ) then
    raise exception 'dashboard snapshot generation backfill is incomplete';
  end if;
  if exists (
    select 1
    from public.dashboard_agent_snapshots
    where generation_id is null
  ) then
    raise exception 'dashboard agent generation backfill is incomplete';
  end if;
  if exists (
    select 1
    from public.dashboard_manager_artifacts
    where month_key is null or generation_id is null
  ) then
    raise exception 'dashboard manager artifact month or generation cannot be resolved';
  end if;
end;
$$;

alter table public.dashboard_login_attempts
  add column if not exists attempts integer;

do $$
begin
  if exists (
    select 1
    from pg_attribute
    where attrelid = 'public.dashboard_login_attempts'::regclass
      and attname = 'failures'
      and not attisdropped
  ) then
    execute 'update public.dashboard_login_attempts '
      || 'set attempts = coalesce(attempts, failures)';
  else
    update public.dashboard_login_attempts
    set attempts = 0
    where attempts is null;
  end if;
end;
$$;

drop function if exists public.dashboard_record_login_failure(
  text,
  timestamptz,
  integer
);

alter table public.dashboard_login_attempts
  drop column if exists failures;
alter table public.dashboard_login_attempts
  alter column attempts set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.dashboard_login_attempts'::regclass
      and conname = 'dashboard_login_attempts_attempts_check'
  ) then
    alter table public.dashboard_login_attempts
      add constraint dashboard_login_attempts_attempts_check
      check (attempts >= 0);
  end if;
end;
$$;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select
      constraint_definition.conrelid::regclass as relation_name,
      constraint_definition.conname
    from pg_constraint as constraint_definition
    where constraint_definition.contype = 'f'
      and constraint_definition.confrelid = 'public.dashboard_snapshots'::regclass
      and constraint_definition.conrelid = any (
        array[
          to_regclass('public.dashboard_agent_snapshots'),
          to_regclass('public.dashboard_manager_artifacts'),
          to_regclass('public.dashboard_active_snapshots')
        ]
      )
  loop
    execute format(
      'alter table %s drop constraint %I',
      constraint_row.relation_name,
      constraint_row.conname
    );
  end loop;
end;
$$;

alter table public.dashboard_agent_snapshots
  drop constraint if exists dashboard_agent_snapshots_pkey;
alter table public.dashboard_manager_artifacts
  drop constraint if exists dashboard_manager_artifacts_pkey;
alter table public.dashboard_snapshots
  drop constraint if exists dashboard_snapshots_pkey;

alter table public.dashboard_snapshots
  alter column generation_id set not null;
alter table public.dashboard_agent_snapshots
  alter column generation_id set not null;
alter table public.dashboard_manager_artifacts
  alter column month_key set not null;
alter table public.dashboard_manager_artifacts
  alter column generation_id set not null;

alter table public.dashboard_snapshots
  add constraint dashboard_snapshots_pkey
  primary key (month, generation_id);
alter table public.dashboard_agent_snapshots
  add constraint dashboard_agent_snapshots_pkey
  primary key (month, generation_id, agent);
alter table public.dashboard_manager_artifacts
  add constraint dashboard_manager_artifacts_pkey
  primary key (month_key, generation_id, artifact_key);

alter table public.dashboard_agent_snapshots
  add constraint dashboard_agent_snapshots_month_generation_id_fkey
  foreign key (month, generation_id)
  references public.dashboard_snapshots(month, generation_id)
  on delete cascade;
alter table public.dashboard_manager_artifacts
  add constraint dashboard_manager_artifacts_month_generation_id_fkey
  foreign key (month_key, generation_id)
  references public.dashboard_snapshots(month, generation_id)
  on delete cascade;

create table if not exists public.dashboard_active_snapshots (
  month_key text primary key,
  generation_id uuid not null,
  activated_at timestamptz not null default now(),
  shared_checksum text not null,
  agent_count integer not null check (agent_count > 0),
  agent_checksums jsonb not null,
  artifact_checksums jsonb not null
);

alter table public.dashboard_active_snapshots
  add constraint dashboard_active_snapshots_month_generation_id_fkey
  foreign key (month_key, generation_id)
  references public.dashboard_snapshots(month, generation_id);

drop index if exists public.dashboard_agent_snapshots_agent_month_idx;
create index dashboard_agent_snapshots_agent_month_idx
  on public.dashboard_agent_snapshots(agent, month, generation_id);
drop index if exists public.dashboard_manager_artifacts_key_idx;
create index dashboard_manager_artifacts_key_idx
  on public.dashboard_manager_artifacts(artifact_key, month_key, generation_id);

do $$
begin
  if exists (
    select 1
    from (
      select distinct month
      from public.dashboard_snapshots
    ) as snapshot_month
    where not exists (
      select 1
      from public.dashboard_snapshots as candidate
      join public.dashboard_agent_snapshots as agent_snapshot
        on agent_snapshot.month = candidate.month
        and agent_snapshot.generation_id = candidate.generation_id
      where candidate.month = snapshot_month.month
    )
  ) then
    raise exception 'dashboard snapshot month has no complete agent generation to activate';
  end if;
end;
$$;

with complete_snapshots as (
  select
    shared_snapshot.*,
    row_number() over (
      partition by shared_snapshot.month
      order by shared_snapshot.generated_at desc, shared_snapshot.generation_id desc
    ) as generation_rank
  from public.dashboard_snapshots as shared_snapshot
  where exists (
    select 1
    from public.dashboard_agent_snapshots as agent_snapshot
    where agent_snapshot.month = shared_snapshot.month
      and agent_snapshot.generation_id = shared_snapshot.generation_id
  )
),
agent_manifests as (
  select
    month,
    generation_id,
    count(*)::integer as agent_count,
    jsonb_object_agg(agent, checksum order by agent) as agent_checksums
  from public.dashboard_agent_snapshots
  group by month, generation_id
),
artifact_manifests as (
  select
    month_key,
    generation_id,
    jsonb_object_agg(
      artifact_key,
      checksum
      order by artifact_key
    ) as artifact_checksums
  from public.dashboard_manager_artifacts
  group by month_key, generation_id
)
insert into public.dashboard_active_snapshots (
  month_key,
  generation_id,
  activated_at,
  shared_checksum,
  agent_count,
  agent_checksums,
  artifact_checksums
)
select
  shared_snapshot.month,
  shared_snapshot.generation_id,
  shared_snapshot.generated_at,
  shared_snapshot.checksum,
  agent_manifest.agent_count,
  agent_manifest.agent_checksums,
  coalesce(artifact_manifest.artifact_checksums, '{}'::jsonb)
from complete_snapshots as shared_snapshot
join agent_manifests as agent_manifest
  on agent_manifest.month = shared_snapshot.month
  and agent_manifest.generation_id = shared_snapshot.generation_id
left join artifact_manifests as artifact_manifest
  on artifact_manifest.month_key = shared_snapshot.month
  and artifact_manifest.generation_id = shared_snapshot.generation_id
where shared_snapshot.generation_rank = 1
on conflict on constraint dashboard_active_snapshots_pkey do nothing;

alter table public.dashboard_active_snapshots enable row level security;
revoke all on public.dashboard_active_snapshots from anon, authenticated;

create or replace function public.dashboard_reserve_login_attempt(
  p_bucket_key text,
  p_attempted_at timestamptz,
  p_window_seconds integer default 900,
  p_max_attempts integer default 5
)
returns table (
  allowed boolean,
  attempt_count integer,
  window_started_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(btrim(p_bucket_key), '') is null then
    raise exception 'bucket key is required';
  end if;
  if p_attempted_at is null then
    raise exception 'attempt timestamp is required';
  end if;
  if p_window_seconds <= 0 then
    raise exception 'window seconds must be positive';
  end if;
  if p_max_attempts <= 0 then
    raise exception 'maximum attempts must be positive';
  end if;

  return query
  with reservation as (
    insert into public.dashboard_login_attempts as current_attempt (
      bucket_key,
      window_started_at,
      attempts
    )
    values (p_bucket_key, p_attempted_at, 1)
    on conflict on constraint dashboard_login_attempts_pkey do update
    set
      window_started_at = case
        when excluded.window_started_at >=
          current_attempt.window_started_at
          + make_interval(secs => p_window_seconds)
        then excluded.window_started_at
        else current_attempt.window_started_at
      end,
      attempts = case
        when excluded.window_started_at >=
          current_attempt.window_started_at
          + make_interval(secs => p_window_seconds)
        then 1
        else current_attempt.attempts + 1
      end
    returning
      current_attempt.attempts as reserved_count,
      current_attempt.window_started_at as reserved_window
  )
  select
    reservation.reserved_count <= p_max_attempts,
    reservation.reserved_count,
    reservation.reserved_window
  from reservation;
end;
$$;

revoke all on function public.dashboard_reserve_login_attempt(
  text,
  timestamptz,
  integer,
  integer
) from public, anon, authenticated;
grant execute on function public.dashboard_reserve_login_attempt(
  text,
  timestamptz,
  integer,
  integer
) to service_role;

create or replace function public.dashboard_activate_snapshot_generation(
  p_month_key text,
  p_generation_id uuid,
  p_shared_checksum text,
  p_agent_checksums jsonb,
  p_artifact_checksums jsonb,
  p_activated_at timestamptz default now()
)
returns table (
  month_key text,
  generation_id uuid,
  activated_at timestamptz,
  shared_checksum text,
  agent_count integer,
  agent_checksums jsonb,
  artifact_checksums jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expected_agent_count integer;
  v_actual_agent_count integer;
  v_expected_artifact_count integer;
  v_actual_artifact_count integer;
begin
  if nullif(btrim(p_month_key), '') is null then
    raise exception 'month key is required';
  end if;
  if p_generation_id is null then
    raise exception 'generation id is required';
  end if;
  if nullif(btrim(p_shared_checksum), '') is null then
    raise exception 'shared checksum is required';
  end if;
  if p_agent_checksums is null
    or jsonb_typeof(p_agent_checksums) <> 'object'
  then
    raise exception 'agent checksum manifest is required';
  end if;
  if p_artifact_checksums is null
    or jsonb_typeof(p_artifact_checksums) <> 'object'
  then
    raise exception 'artifact checksum manifest is required';
  end if;
  if p_activated_at is null then
    raise exception 'activation timestamp is required';
  end if;

  v_expected_agent_count := jsonb_object_length(p_agent_checksums);
  v_expected_artifact_count := jsonb_object_length(p_artifact_checksums);
  if v_expected_agent_count <= 0 then
    raise exception 'agent checksum manifest is empty';
  end if;
  if v_expected_artifact_count <= 0 then
    raise exception 'artifact checksum manifest is empty';
  end if;

  perform 1
  from public.dashboard_snapshots as staged
  where staged.month = p_month_key
    and staged.generation_id = p_generation_id
    and staged.checksum = p_shared_checksum
  for share;
  if not found then
    raise exception 'staged shared snapshot is missing or invalid';
  end if;

  select count(*)
  into v_actual_agent_count
  from public.dashboard_agent_snapshots as staged
  where staged.month = p_month_key
    and staged.generation_id = p_generation_id;
  if v_actual_agent_count <> v_expected_agent_count then
    raise exception 'staged agent snapshot count mismatch';
  end if;
  if exists (
    select 1
    from jsonb_each_text(p_agent_checksums) as expected(agent, checksum)
    left join public.dashboard_agent_snapshots as staged
      on staged.month = p_month_key
      and staged.generation_id = p_generation_id
      and staged.agent = expected.agent
      and staged.checksum = expected.checksum
    where staged.agent is null
  ) then
    raise exception 'staged agent snapshot checksum mismatch';
  end if;

  select count(*)
  into v_actual_artifact_count
  from public.dashboard_manager_artifacts as staged
  where staged.month_key = p_month_key
    and staged.generation_id = p_generation_id;
  if v_actual_artifact_count <> v_expected_artifact_count then
    raise exception 'staged manager artifact count mismatch';
  end if;
  if exists (
    select 1
    from jsonb_each_text(p_artifact_checksums) as expected(artifact_key, checksum)
    left join public.dashboard_manager_artifacts as staged
      on staged.month_key = p_month_key
      and staged.generation_id = p_generation_id
      and staged.artifact_key = expected.artifact_key
      and staged.checksum = expected.checksum
    where staged.artifact_key is null
  ) then
    raise exception 'staged manager artifact checksum mismatch';
  end if;

  return query
  insert into public.dashboard_active_snapshots as active_snapshot (
    month_key,
    generation_id,
    activated_at,
    shared_checksum,
    agent_count,
    agent_checksums,
    artifact_checksums
  )
  values (
    p_month_key,
    p_generation_id,
    p_activated_at,
    p_shared_checksum,
    v_expected_agent_count,
    p_agent_checksums,
    p_artifact_checksums
  )
  on conflict on constraint dashboard_active_snapshots_pkey do update
  set
    generation_id = excluded.generation_id,
    activated_at = excluded.activated_at,
    shared_checksum = excluded.shared_checksum,
    agent_count = excluded.agent_count,
    agent_checksums = excluded.agent_checksums,
    artifact_checksums = excluded.artifact_checksums
  returning
    active_snapshot.month_key,
    active_snapshot.generation_id,
    active_snapshot.activated_at,
    active_snapshot.shared_checksum,
    active_snapshot.agent_count,
    active_snapshot.agent_checksums,
    active_snapshot.artifact_checksums;
end;
$$;

revoke all on function public.dashboard_activate_snapshot_generation(
  text,
  uuid,
  text,
  jsonb,
  jsonb,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.dashboard_activate_snapshot_generation(
  text,
  uuid,
  text,
  jsonb,
  jsonb,
  timestamptz
) to service_role;

commit;
