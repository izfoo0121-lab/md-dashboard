begin;

alter table public.agent_pins enable row level security;
alter table if exists public.targets_pins enable row level security;

revoke all on table public.agent_pins from anon, authenticated;

do $$
begin
  if to_regclass('public.targets_pins') is not null then
    execute 'revoke all on table public.targets_pins from anon, authenticated';
  end if;
end
$$;

commit;
