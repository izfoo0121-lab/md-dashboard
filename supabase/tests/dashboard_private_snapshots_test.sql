begin;

select plan(30);

select has_table('public', 'dashboard_snapshots');
select has_table('public', 'dashboard_agent_snapshots');
select has_table('public', 'dashboard_manager_artifacts');
select has_table('public', 'dashboard_active_snapshots');
select has_table('public', 'dashboard_sessions');
select has_table('public', 'dashboard_login_attempts');
select has_pk('public', 'dashboard_snapshots');
select has_pk('public', 'dashboard_manager_artifacts');
select col_is_pk('public', 'dashboard_sessions', 'token_hash');
select has_pk('public', 'dashboard_agent_snapshots');
select row_security_active('public', 'dashboard_snapshots');
select row_security_active('public', 'dashboard_agent_snapshots');
select row_security_active('public', 'dashboard_manager_artifacts');
select row_security_active('public', 'dashboard_active_snapshots');
select row_security_active('public', 'dashboard_sessions');
select row_security_active('public', 'dashboard_login_attempts');
select has_column(
  'public',
  'dashboard_snapshots',
  'manager_support_payload'
);
select has_column('public', 'dashboard_snapshots', 'generation_id');
select has_column('public', 'dashboard_agent_snapshots', 'generation_id');
select has_column('public', 'dashboard_manager_artifacts', 'generation_id');
select has_column('public', 'dashboard_active_snapshots', 'generation_id');
select has_function(
  'public',
  'dashboard_activate_snapshot_generation',
  array[
    'text',
    'uuid',
    'text',
    'jsonb',
    'jsonb',
    'timestamp with time zone'
  ]
);
select has_function(
  'public',
  'dashboard_reserve_login_attempt',
  array['text', 'timestamp with time zone', 'integer', 'integer']
);
select ok(
  (
    select allowed and attempt_count = 1
    from public.dashboard_reserve_login_attempt(
      'pgtap-bucket',
      '2026-07-14T12:00:00Z'::timestamptz,
      900,
      5
    )
  ),
  'first attempt is admitted'
);
select ok(
  (
    select allowed and attempt_count = 2
    from public.dashboard_reserve_login_attempt(
      'pgtap-bucket',
      '2026-07-14T12:00:01Z'::timestamptz,
      900,
      5
    )
  ),
  'second attempt is admitted'
);
select ok(
  (
    select allowed and attempt_count = 3
    from public.dashboard_reserve_login_attempt(
      'pgtap-bucket',
      '2026-07-14T12:00:02Z'::timestamptz,
      900,
      5
    )
  ),
  'third attempt is admitted'
);
select ok(
  (
    select allowed and attempt_count = 4
    from public.dashboard_reserve_login_attempt(
      'pgtap-bucket',
      '2026-07-14T12:00:03Z'::timestamptz,
      900,
      5
    )
  ),
  'fourth attempt is admitted'
);
select ok(
  (
    select allowed and attempt_count = 5
    from public.dashboard_reserve_login_attempt(
      'pgtap-bucket',
      '2026-07-14T12:00:04Z'::timestamptz,
      900,
      5
    )
  ),
  'fifth attempt is admitted'
);
select ok(
  (
    select not allowed and attempt_count = 6
    from public.dashboard_reserve_login_attempt(
      'pgtap-bucket',
      '2026-07-14T12:00:05Z'::timestamptz,
      900,
      5
    )
  ),
  'sixth attempt is rejected before authentication'
);
select ok(
  (
    select allowed and attempt_count = 1
    from public.dashboard_reserve_login_attempt(
      'pgtap-bucket',
      '2026-07-14T12:15:01Z'::timestamptz,
      900,
      5
    )
  ),
  'an attempt after the window starts a new counter'
);

select * from finish();

rollback;
