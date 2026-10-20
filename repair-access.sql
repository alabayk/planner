-- Run in the existing project's SQL Editor as postgres.
-- Restores required table grants; does not disable or replace RLS policies.
begin;
grant usage on schema public to authenticated, service_role;
revoke all on public.planner_events from anon;
grant select, insert, update on public.planner_events to authenticated;
grant select, insert, update on public.planner_events to service_role;

-- Optional modules may not have been installed in every deployment.
do $$
begin
  if to_regclass('public.planner_messages') is not null then
    grant select, insert on public.planner_messages to authenticated;
    grant select, insert, update, delete on public.planner_messages to service_role;
  end if;
  if to_regclass('public.push_jobs') is not null then
    grant select, insert, update, delete on public.push_jobs to authenticated, service_role;
  end if;
  if to_regclass('public.push_subscriptions') is not null then
    grant select, insert, update, delete on public.push_subscriptions to authenticated, service_role;
  end if;
  if to_regclass('public.planner_google_tokens') is not null then
    grant select, insert, update, delete on public.planner_google_tokens to service_role;
  end if;
  if to_regclass('public.planner_google_links') is not null then
    grant select, insert, update, delete on public.planner_google_links to service_role;
  end if;
  if to_regclass('public.planner_google_states') is not null then
    grant select, insert, update, delete on public.planner_google_states to service_role;
  end if;
  if to_regclass('public.planner_google_conflicts') is not null then
    grant select, insert, update, delete on public.planner_google_conflicts to service_role;
  end if;
end $$;
commit;

select
  (has_table_privilege('authenticated','public.planner_events','SELECT') and has_table_privilege('authenticated','public.planner_events','INSERT') and has_table_privilege('authenticated','public.planner_events','UPDATE')) as application_access,
  (has_table_privilege('service_role','public.planner_events','SELECT') and has_table_privilege('service_role','public.planner_events','INSERT') and has_table_privilege('service_role','public.planner_events','UPDATE')) as server_access,
  c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies where schemaname='public' and tablename='planner_events') as policy_count
from pg_class c where c.oid='public.planner_events'::regclass;
