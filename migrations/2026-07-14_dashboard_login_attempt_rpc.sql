begin;

create or replace function public.dashboard_record_login_failure(
  p_bucket_key text,
  p_attempted_at timestamptz,
  p_window_seconds integer default 900
)
returns table (
  bucket_key text,
  window_started_at timestamptz,
  failures integer
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

  return query
  insert into public.dashboard_login_attempts as current_attempt (
    bucket_key,
    window_started_at,
    failures
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
    failures = case
      when excluded.window_started_at >=
        current_attempt.window_started_at
        + make_interval(secs => p_window_seconds)
      then 1
      else current_attempt.failures + 1
    end
  returning
    current_attempt.bucket_key,
    current_attempt.window_started_at,
    current_attempt.failures;
end;
$$;

revoke all on function public.dashboard_record_login_failure(
  text,
  timestamptz,
  integer
) from public, anon, authenticated;
grant execute on function public.dashboard_record_login_failure(
  text,
  timestamptz,
  integer
) to service_role;

commit;
