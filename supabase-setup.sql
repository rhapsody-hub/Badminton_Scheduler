-- Badminton Session Manager - Supabase setup
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.badminton_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.badminton_workspace_members (
  workspace_id uuid not null references public.badminton_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'coordinator' check (role in ('owner','coordinator')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists badminton_workspace_members_user_id_idx
  on public.badminton_workspace_members(user_id);

create table if not exists public.badminton_workspace_state (
  workspace_id uuid primary key references public.badminton_workspaces(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.badminton_session_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.badminton_workspaces(id) on delete cascade,
  name text not null,
  state jsonb not null,
  saved_at timestamptz not null default now(),
  saved_by uuid references auth.users(id) on delete set null
);

create index if not exists badminton_session_history_workspace_idx
  on public.badminton_session_history(workspace_id, saved_at desc);

create or replace function private.badminton_user_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select m.workspace_id
  from public.badminton_workspace_members m
  where m.user_id = (select auth.uid());
$$;

revoke all on function private.badminton_user_workspace_ids() from public;
grant usage on schema private to authenticated;
grant execute on function private.badminton_user_workspace_ids() to authenticated;

create or replace function public.create_badminton_workspace(p_name text)
returns table(workspace_id uuid, join_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_code text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (
      select 1 from public.badminton_workspaces w where w.join_code = v_code
    );
  end loop;

  insert into public.badminton_workspaces(name, join_code, owner_id)
  values (
    coalesce(nullif(trim(p_name), ''), 'Badminton Workspace'),
    v_code,
    (select auth.uid())
  )
  returning id into v_workspace_id;

  insert into public.badminton_workspace_members(workspace_id, user_id, role)
  values (v_workspace_id, (select auth.uid()), 'owner');

  return query select v_workspace_id, v_code;
end;
$$;

revoke all on function public.create_badminton_workspace(text) from public;
grant execute on function public.create_badminton_workspace(text) to authenticated;

create or replace function public.join_badminton_workspace(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select w.id into v_workspace_id
  from public.badminton_workspaces w
  where upper(w.join_code) = upper(trim(p_join_code))
  limit 1;

  if v_workspace_id is null then
    raise exception 'Workspace code not found';
  end if;

  insert into public.badminton_workspace_members(workspace_id, user_id, role)
  values (v_workspace_id, (select auth.uid()), 'coordinator')
  on conflict (workspace_id, user_id) do nothing;

  return v_workspace_id;
end;
$$;

revoke all on function public.join_badminton_workspace(text) from public;
grant execute on function public.join_badminton_workspace(text) to authenticated;

alter table public.badminton_workspaces enable row level security;
alter table public.badminton_workspace_members enable row level security;
alter table public.badminton_workspace_state enable row level security;
alter table public.badminton_session_history enable row level security;

revoke all on table public.badminton_workspaces from anon, authenticated;
revoke all on table public.badminton_workspace_members from anon, authenticated;
revoke all on table public.badminton_workspace_state from anon, authenticated;
revoke all on table public.badminton_session_history from anon, authenticated;

grant select, update on table public.badminton_workspaces to authenticated;
grant select on table public.badminton_workspace_members to authenticated;
grant select, insert, update, delete on table public.badminton_workspace_state to authenticated;
grant select, insert, delete on table public.badminton_session_history to authenticated;

drop policy if exists "members read workspaces" on public.badminton_workspaces;
create policy "members read workspaces"
on public.badminton_workspaces for select to authenticated
using (id in (select private.badminton_user_workspace_ids()));

drop policy if exists "members update workspace" on public.badminton_workspaces;
create policy "members update workspace"
on public.badminton_workspaces for update to authenticated
using (id in (select private.badminton_user_workspace_ids()))
with check (id in (select private.badminton_user_workspace_ids()));

drop policy if exists "members read memberships" on public.badminton_workspace_members;
create policy "members read memberships"
on public.badminton_workspace_members for select to authenticated
using (workspace_id in (select private.badminton_user_workspace_ids()));

drop policy if exists "members read current state" on public.badminton_workspace_state;
create policy "members read current state"
on public.badminton_workspace_state for select to authenticated
using (workspace_id in (select private.badminton_user_workspace_ids()));

drop policy if exists "members insert current state" on public.badminton_workspace_state;
create policy "members insert current state"
on public.badminton_workspace_state for insert to authenticated
with check (
  workspace_id in (select private.badminton_user_workspace_ids())
  and updated_by = (select auth.uid())
);

drop policy if exists "members update current state" on public.badminton_workspace_state;
create policy "members update current state"
on public.badminton_workspace_state for update to authenticated
using (workspace_id in (select private.badminton_user_workspace_ids()))
with check (
  workspace_id in (select private.badminton_user_workspace_ids())
  and updated_by = (select auth.uid())
);

drop policy if exists "members delete current state" on public.badminton_workspace_state;
create policy "members delete current state"
on public.badminton_workspace_state for delete to authenticated
using (workspace_id in (select private.badminton_user_workspace_ids()));

drop policy if exists "members read session history" on public.badminton_session_history;
create policy "members read session history"
on public.badminton_session_history for select to authenticated
using (workspace_id in (select private.badminton_user_workspace_ids()));

drop policy if exists "members insert session history" on public.badminton_session_history;
create policy "members insert session history"
on public.badminton_session_history for insert to authenticated
with check (
  workspace_id in (select private.badminton_user_workspace_ids())
  and saved_by = (select auth.uid())
);

drop policy if exists "members delete session history" on public.badminton_session_history;
create policy "members delete session history"
on public.badminton_session_history for delete to authenticated
using (workspace_id in (select private.badminton_user_workspace_ids()));

-- Realtime for the current shared state.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'badminton_workspace_state'
  ) then
    alter publication supabase_realtime add table public.badminton_workspace_state;
  end if;
end
$$;


-- ============================================================
-- Approved coordinator allowlist
-- ============================================================

create table if not exists public.badminton_coordinators (
  email text primary key,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint badminton_coordinators_email_lowercase
    check (email = lower(trim(email))),
  constraint badminton_coordinators_email_shape
    check (position('@' in email) > 1)
);

alter table public.badminton_coordinators enable row level security;
revoke all on table public.badminton_coordinators from anon, authenticated;

insert into public.badminton_coordinators(email, added_by)
select lower(trim(u.email)), wm.user_id
from public.badminton_workspace_members wm
join auth.users u on u.id = wm.user_id
where u.email is not null
on conflict (email) do nothing;

create or replace function public.is_badminton_coordinator(p_email text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.badminton_coordinators c
    where c.email = lower(trim(p_email))
  );
$$;

revoke all on function public.is_badminton_coordinator(text) from public;
grant execute on function public.is_badminton_coordinator(text) to anon, authenticated;

create or replace function public.list_badminton_coordinators()
returns table(email text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  v_email := lower(coalesce((select auth.jwt() ->> 'email'), ''));

  if not exists (
    select 1
    from public.badminton_coordinators c
    where c.email = v_email
  ) then
    raise exception 'Coordinator access required';
  end if;

  return query
  select c.email, c.created_at
  from public.badminton_coordinators c
  order by c.email;
end;
$$;

revoke all on function public.list_badminton_coordinators() from public, anon;
grant execute on function public.list_badminton_coordinators() to authenticated;

create or replace function public.add_badminton_coordinator(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_email text;
  v_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  v_caller_email := lower(coalesce((select auth.jwt() ->> 'email'), ''));

  if not exists (
    select 1
    from public.badminton_coordinators c
    where c.email = v_caller_email
  ) then
    raise exception 'Coordinator access required';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));

  if length(v_email) < 3 or position('@' in v_email) <= 1 then
    raise exception 'Enter a valid email address';
  end if;

  insert into public.badminton_coordinators(email, added_by)
  values (v_email, (select auth.uid()))
  on conflict (email) do nothing;

  return v_email;
end;
$$;

revoke all on function public.add_badminton_coordinator(text) from public, anon;
grant execute on function public.add_badminton_coordinator(text) to authenticated;

create or replace function public.remove_badminton_coordinator(p_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_email text;
  v_email text;
  v_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  v_caller_email := lower(coalesce((select auth.jwt() ->> 'email'), ''));

  if not exists (
    select 1
    from public.badminton_coordinators c
    where c.email = v_caller_email
  ) then
    raise exception 'Coordinator access required';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));

  if v_email = v_caller_email then
    raise exception 'You cannot remove your own coordinator email';
  end if;

  select count(*) into v_count
  from public.badminton_coordinators;

  if v_count <= 1 then
    raise exception 'At least one coordinator must remain';
  end if;

  delete from public.badminton_coordinators
  where email = v_email;

  return found;
end;
$$;

revoke all on function public.remove_badminton_coordinator(text) from public, anon;
grant execute on function public.remove_badminton_coordinator(text) to authenticated;

create or replace function public.create_badminton_workspace(p_name text)
returns table(workspace_id uuid, join_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_code text;
  v_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  v_email := lower(coalesce((select auth.jwt() ->> 'email'), ''));

  if not exists (
    select 1 from public.badminton_coordinators c where c.email = v_email
  ) then
    raise exception 'Coordinator access required';
  end if;

  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (
      select 1
      from public.badminton_workspaces w
      where w.join_code = v_code
    );
  end loop;

  insert into public.badminton_workspaces(name, join_code, owner_id)
  values (
    coalesce(nullif(trim(p_name), ''), 'Badminton Workspace'),
    v_code,
    (select auth.uid())
  )
  returning id into v_workspace_id;

  insert into public.badminton_workspace_members(workspace_id, user_id, role)
  values (v_workspace_id, (select auth.uid()), 'owner');

  return query select v_workspace_id, v_code;
end;
$$;

create or replace function public.join_badminton_workspace(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  v_email := lower(coalesce((select auth.jwt() ->> 'email'), ''));

  if not exists (
    select 1 from public.badminton_coordinators c where c.email = v_email
  ) then
    raise exception 'Coordinator access required';
  end if;

  select w.id
  into v_workspace_id
  from public.badminton_workspaces w
  where upper(w.join_code) = upper(trim(p_join_code))
  limit 1;

  if v_workspace_id is null then
    raise exception 'Workspace code not found';
  end if;

  insert into public.badminton_workspace_members(workspace_id, user_id, role)
  values (v_workspace_id, (select auth.uid()), 'coordinator')
  on conflict (workspace_id, user_id) do nothing;

  return v_workspace_id;
end;
$$;


-- Coordinator creation now requires an initial password and is handled by the
-- authenticated `badminton-coordinator-admin` Edge Function. Prevent older
-- browser builds from adding allowlist rows without provisioning credentials.
revoke execute on function public.add_badminton_coordinator(text) from authenticated;
