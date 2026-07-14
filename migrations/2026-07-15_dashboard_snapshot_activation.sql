begin;

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
