begin;

select plan(19);

select has_table('public', 'dashboard_snapshots');
select has_table('public', 'dashboard_agent_snapshots');
select has_table('public', 'dashboard_manager_artifacts');
select has_table('public', 'dashboard_sessions');
select has_table('public', 'dashboard_login_attempts');
select col_is_pk('public', 'dashboard_snapshots', 'month');
select col_is_pk('public', 'dashboard_manager_artifacts', 'artifact_key');
select col_is_pk('public', 'dashboard_sessions', 'token_hash');
select has_pk('public', 'dashboard_agent_snapshots');
select row_security_active('public', 'dashboard_snapshots');
select row_security_active('public', 'dashboard_agent_snapshots');
select row_security_active('public', 'dashboard_manager_artifacts');
select row_security_active('public', 'dashboard_sessions');
select row_security_active('public', 'dashboard_login_attempts');
select has_column(
  'public',
  'dashboard_snapshots',
  'manager_support_payload'
);
select has_function(
  'public',
  'dashboard_record_login_failure',
  array['text', 'timestamp with time zone', 'integer']
);
select is(
  (
    select failures
    from public.dashboard_record_login_failure(
      'pgtap-bucket',
      '2026-07-14T12:00:00Z'::timestamptz,
      900
    )
  ),
  1,
  'first failed login starts the bucket window'
);
select is(
  (
    select failures
    from public.dashboard_record_login_failure(
      'pgtap-bucket',
      '2026-07-14T12:00:01Z'::timestamptz,
      900
    )
  ),
  2,
  'a failure in the active window increments atomically'
);
select is(
  (
    select failures
    from public.dashboard_record_login_failure(
      'pgtap-bucket',
      '2026-07-14T12:15:01Z'::timestamptz,
      900
    )
  ),
  1,
  'a failure after the window starts a new counter'
);

select * from finish();

rollback;
