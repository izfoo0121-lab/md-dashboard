begin;

select plan(15);

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

select * from finish();

rollback;
