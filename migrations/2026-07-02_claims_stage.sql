begin;

alter table public.claims
  add column if not exists stage integer not null default 1;

update public.claims
set stage = 1
where stage is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.claims'::regclass
      and conname = 'claims_stage_check'
  ) then
    alter table public.claims
      add constraint claims_stage_check check (stage in (1, 2));
  end if;
end $$;

create unique index if not exists claims_month_agent_camp_debtor_stage_uidx
  on public.claims (month, agent, camp_id, debtor_code, stage);

commit;
