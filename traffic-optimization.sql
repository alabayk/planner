-- Apply once in SQL Editor. Does not replace event data or change event RLS.
begin;
alter table public.planner_google_links add column if not exists version bigint not null default 1;
alter table public.planner_google_links add column if not exists updated_at timestamptz not null default now();
create or replace function public.planner_link_revision() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin new.version:=old.version+1;new.updated_at:=clock_timestamp();return new;end $$;
drop trigger if exists planner_link_revision on public.planner_google_links;
create trigger planner_link_revision before update on public.planner_google_links for each row execute function public.planner_link_revision();
create index if not exists planner_links_owner_revision on public.planner_google_links(owner,version,planner_id);
create index if not exists planner_events_revision on public.planner_events(updated_at,id);
create table if not exists public.planner_traffic_batches(id uuid primary key,month date not null,bytes bigint not null check(bytes>=0),requests bigint not null check(requests>=0),created_at timestamptz not null default now());
create index if not exists planner_traffic_month on public.planner_traffic_batches(month,created_at);
alter table public.planner_traffic_batches enable row level security;
revoke all on public.planner_traffic_batches from public,anon,authenticated;
create or replace function public.planner_record_traffic(batch_id uuid,byte_count bigint,request_count bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare m date:=date_trunc('month',now() at time zone 'Europe/Moscow')::date;total bigint;daily bigint;
begin
 if byte_count<0 or request_count<0 then raise exception 'Invalid counters';end if;
 insert into public.planner_traffic_batches(id,month,bytes,requests) values(batch_id,m,byte_count,request_count) on conflict(id) do nothing;
 select coalesce(sum(bytes),0) into total from public.planner_traffic_batches where month=m;
 select coalesce(sum(bytes),0) into daily from public.planner_traffic_batches where month=m and created_at>=((now() at time zone 'Europe/Moscow')::date::timestamp at time zone 'Europe/Moscow');
 return jsonb_build_object('month',m,'bytes',total,'day_bytes',daily);
end $$;
revoke all on function public.planner_record_traffic(uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.planner_record_traffic(uuid,bigint,bigint) to service_role;
commit;
select 'traffic-schema-v1 ready' as result;
