-- GeoVisualise — Supabase schema for user accounts + saved projects
-- Run this ONCE in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
--
-- Design note: a saved "project" is just the SAME project-CSV blob that the
-- Download/Load project CSV buttons already produce (web/project_csv.js), which
-- round-trips the whole workspace losslessly — boreholes, trial pits, grades,
-- site boundary AND the cross-section line. Storing that one blob means the
-- cloud save format cannot drift out of sync with the local one, and the
-- existing round-trip test (web/test_project_csv.mjs) already guards it.
-- `meta` holds only a small denormalised summary so the project picker can
-- show useful detail without downloading and parsing every CSV.

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 120),
  csv         text not null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Listing is always "my projects, newest first".
create index if not exists projects_user_updated_idx
  on public.projects (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security. THIS IS THE ONLY THING PROTECTING USER DATA.
-- The anon key shipped in the frontend is public by design (it is in every
-- client-side Supabase app); RLS is what stops one user reading another's
-- projects. Do not disable it, and do not ship the service_role key.
-- ---------------------------------------------------------------------------
alter table public.projects enable row level security;

drop policy if exists "own projects: select" on public.projects;
create policy "own projects: select" on public.projects
  for select using (auth.uid() = user_id);

drop policy if exists "own projects: insert" on public.projects;
create policy "own projects: insert" on public.projects
  for insert with check (auth.uid() = user_id);

drop policy if exists "own projects: update" on public.projects;
create policy "own projects: update" on public.projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own projects: delete" on public.projects;
create policy "own projects: delete" on public.projects
  for delete using (auth.uid() = user_id);

-- Keep updated_at honest server-side rather than trusting the client.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();
