create table if not exists public.planner_messages (
  id uuid primary key,
  created_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  sender text not null check (sender in ('vanya', 'ksusha')),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table public.planner_messages enable row level security;
revoke all on public.planner_messages from anon;
grant select, insert on public.planner_messages to authenticated;

drop policy if exists "chat read" on public.planner_messages;
create policy "chat read" on public.planner_messages for select to authenticated using (true);
drop policy if exists "chat send" on public.planner_messages;
create policy "chat send" on public.planner_messages for insert to authenticated with check (created_by = auth.uid());

do $$ begin
  alter publication supabase_realtime add table public.planner_messages;
exception when duplicate_object then null;
end $$;
