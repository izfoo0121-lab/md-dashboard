begin;

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

commit;
