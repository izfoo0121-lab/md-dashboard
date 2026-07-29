begin;

set local lock_timeout = '5s';

do $$
begin
  if exists (
    select 1
    from public.claims
    where stage is null
  ) then
    raise exception 'claims stage PK cutover blocked: stage contains null rows';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from (
      select month, agent, camp_id, debtor_code, stage, count(*) as row_count
      from public.claims
      group by 1, 2, 3, 4, 5
      having count(*) > 1
    ) duplicates
  ) then
    raise exception 'claims stage PK cutover blocked: duplicate 5-column claim identities exist';
  end if;
end $$;

lock table public.claims in access exclusive mode;

alter table public.claims drop constraint claims_pkey;

alter table public.claims
  add constraint claims_pkey
  primary key using index claims_month_agent_camp_debtor_stage_uidx;

notify pgrst, 'reload schema';

commit;
