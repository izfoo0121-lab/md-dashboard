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

do $$
declare
  rec record;
begin
  for rec in
    select c.conname
    from pg_constraint c
    join lateral (
      select array_agg(a.attname::text order by a.attname) as cols
      from unnest(c.conkey) ck(attnum)
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = ck.attnum
    ) names on true
    where c.conrelid = 'public.claims'::regclass
      and c.contype = 'u'
      and names.cols = array['agent','camp_id','debtor_code','month']::text[]
  loop
    execute format('alter table public.claims drop constraint %I', rec.conname);
  end loop;
end $$;

do $$
declare
  rec record;
begin
  for rec in
    select idx.relname
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    join lateral (
      select array_agg(a.attname::text order by a.attname) as cols
      from unnest(i.indkey) k(attnum)
      join pg_attribute a
        on a.attrelid = i.indrelid
       and a.attnum = k.attnum
      where k.attnum > 0
    ) names on true
    where i.indrelid = 'public.claims'::regclass
      and i.indisunique
      and names.cols = array['agent','camp_id','debtor_code','month']::text[]
  loop
    execute format('drop index if exists public.%I', rec.relname);
  end loop;
end $$;

create unique index if not exists claims_month_agent_camp_debtor_stage_uidx
  on public.claims (month, agent, camp_id, debtor_code, stage);

commit;
