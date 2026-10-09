create table if not exists public.planner_google_tokens (
  owner text primary key,
  refresh_token text not null,
  access_token text,
  expires_at bigint not null default 0,
  calendar_id text,
  updated_at timestamptz not null default now()
);

create table if not exists public.planner_google_links (
  planner_id uuid not null references public.planner_events(id) on delete cascade,
  owner text not null,
  google_id text not null,
  planner_signature text not null,
  google_etag text,
  primary key (planner_id, owner),
  unique (owner, google_id)
);

create table if not exists public.planner_google_states (
  state text primary key,
  owner text not null,
  expires_at timestamptz not null
);

create table if not exists public.planner_google_conflicts (
  id bigint generated always as identity primary key,
  planner_id text,
  owner text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.planner_google_tokens enable row level security;
alter table public.planner_google_links enable row level security;
alter table public.planner_google_states enable row level security;
alter table public.planner_google_conflicts enable row level security;

revoke all on public.planner_google_tokens from anon, authenticated;
revoke all on public.planner_google_links from anon, authenticated;
revoke all on public.planner_google_states from anon, authenticated;
revoke all on public.planner_google_conflicts from anon, authenticated;
