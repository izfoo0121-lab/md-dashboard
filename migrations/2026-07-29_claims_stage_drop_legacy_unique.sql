begin;
set local lock_timeout = '5s';
lock table public.claims in access exclusive mode;
alter table public.claims drop constraint claims_pkey;
alter table public.claims
  add constraint claims_pkey
  primary key using index claims_month_agent_camp_debtor_stage_uidx;
notify pgrst, 'reload schema';
commit;
