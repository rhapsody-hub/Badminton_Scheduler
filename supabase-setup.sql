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


-- ============================================================
-- Owner-managed coordinator access across multiple workspaces
-- ============================================================

create or replace function public.list_owned_badminton_workspace_access()
returns table(
  workspace_id uuid,
  workspace_name text,
  coordinator_email text,
  member_role text,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_caller_email text;
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

  return query
  select
    w.id,
    w.name,
    lower(u.email),
    wm.role,
    wm.joined_at
  from public.badminton_workspaces w
  join public.badminton_workspace_members wm
    on wm.workspace_id = w.id
  join auth.users u
    on u.id = wm.user_id
  where w.owner_id = (select auth.uid())
    and u.email is not null
  order by w.created_at, lower(u.email);
end;
$$;

revoke all on function public.list_owned_badminton_workspace_access()
  from public, anon;
grant execute on function public.list_owned_badminton_workspace_access()
  to authenticated;

create or replace function public.grant_badminton_workspace_access(
  p_workspace_id uuid,
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_target_user_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.badminton_workspaces w
    where w.id = p_workspace_id
      and w.owner_id = (select auth.uid())
  ) then
    raise exception 'Only the workspace owner can grant access';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));

  if not exists (
    select 1
    from public.badminton_coordinators c
    where c.email = v_email
  ) then
    raise exception 'The email must be an approved coordinator first';
  end if;

  select u.id
  into v_target_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_target_user_id is null then
    raise exception 'No Supabase Auth account exists for this coordinator';
  end if;

  insert into public.badminton_workspace_members(
    workspace_id,
    user_id,
    role
  )
  values (
    p_workspace_id,
    v_target_user_id,
    case
      when v_target_user_id = (select auth.uid()) then 'owner'
      else 'coordinator'
    end
  )
  on conflict (workspace_id, user_id)
  do update set role =
    case
      when public.badminton_workspace_members.role = 'owner'
        then 'owner'
      else 'coordinator'
    end;

  return true;
end;
$$;

revoke all on function public.grant_badminton_workspace_access(uuid, text)
  from public, anon;
grant execute on function public.grant_badminton_workspace_access(uuid, text)
  to authenticated;

create or replace function public.revoke_badminton_workspace_access(
  p_workspace_id uuid,
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_target_user_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.badminton_workspaces w
    where w.id = p_workspace_id
      and w.owner_id = (select auth.uid())
  ) then
    raise exception 'Only the workspace owner can remove access';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));

  select u.id
  into v_target_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_target_user_id is null then
    return false;
  end if;

  if v_target_user_id = (select auth.uid()) then
    raise exception 'The workspace owner cannot remove their own access';
  end if;

  delete from public.badminton_workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = v_target_user_id
    and wm.role <> 'owner';

  return found;
end;
$$;

revoke all on function public.revoke_badminton_workspace_access(uuid, text)
  from public, anon;
grant execute on function public.revoke_badminton_workspace_access(uuid, text)
  to authenticated;

-- ============================================================
-- Workspace Co-owners + website-wide Owner authorization credential
-- ============================================================

alter table public.badminton_workspace_members
  drop constraint if exists badminton_workspace_members_role_check;

alter table public.badminton_workspace_members
  add constraint badminton_workspace_members_role_check
  check (
    role = any (
      array[
        'owner'::text,
        'co-owner'::text,
        'coordinator'::text
      ]
    )
  );

create table if not exists public.badminton_site_owner_security (
  singleton boolean primary key
    default true
    check (singleton = true),
  site_owner_id uuid not null
    references auth.users(id) on delete restrict,
  credential_hash text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.badminton_site_owner_security enable row level security;

revoke all on table public.badminton_site_owner_security
  from public, anon, authenticated;

-- When workspaces already exist during migration, the owner of the first
-- workspace becomes the Website Owner. For a brand-new installation the
-- credential setter below can initialize this after the first workspace exists.
insert into public.badminton_site_owner_security(
  singleton,
  site_owner_id,
  credential_hash,
  updated_at,
  updated_by
)
select
  true,
  first_workspace.owner_id,
  null,
  now(),
  first_workspace.owner_id
from (
  select w.owner_id
  from public.badminton_workspaces w
  order by w.created_at asc, w.id asc
  limit 1
) first_workspace
on conflict (singleton) do nothing;

create or replace function public.get_badminton_site_owner_status()
returns table(
  is_site_owner boolean,
  credential_set boolean
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_site_owner uuid;
  v_hash text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select security.site_owner_id, security.credential_hash
  into v_site_owner, v_hash
  from public.badminton_site_owner_security security
  where security.singleton = true;

  if v_site_owner is null then
    select w.owner_id
    into v_site_owner
    from public.badminton_workspaces w
    order by w.created_at asc, w.id asc
    limit 1;
  end if;

  return query
  select
    v_site_owner = (select auth.uid()),
    v_hash is not null;
end;
$$;

revoke all on function public.get_badminton_site_owner_status()
  from public, anon;
grant execute on function public.get_badminton_site_owner_status()
  to authenticated;

create or replace function public.set_badminton_site_owner_credential(
  p_credential text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential text := coalesce(p_credential, '');
  v_existing_owner uuid;
  v_first_owner uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if length(v_credential) < 8 then
    raise exception 'Owner credential must be at least 8 characters';
  end if;

  select security.site_owner_id
  into v_existing_owner
  from public.badminton_site_owner_security security
  where security.singleton = true;

  if v_existing_owner is null then
    select w.owner_id
    into v_first_owner
    from public.badminton_workspaces w
    order by w.created_at asc, w.id asc
    limit 1;

    if v_first_owner is null
       or v_first_owner <> (select auth.uid())
    then
      raise exception 'Only the Website Owner can set the Owner credential';
    end if;

    insert into public.badminton_site_owner_security(
      singleton,
      site_owner_id,
      credential_hash,
      updated_at,
      updated_by
    )
    values (
      true,
      (select auth.uid()),
      extensions.crypt(
        v_credential,
        extensions.gen_salt('bf', 10)
      ),
      now(),
      (select auth.uid())
    )
    on conflict (singleton)
    do update set
      credential_hash = excluded.credential_hash,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

    return true;
  end if;

  if v_existing_owner <> (select auth.uid()) then
    raise exception 'Only the Website Owner can set the Owner credential';
  end if;

  update public.badminton_site_owner_security
  set
    credential_hash = extensions.crypt(
      v_credential,
      extensions.gen_salt('bf', 10)
    ),
    updated_at = now(),
    updated_by = (select auth.uid())
  where singleton = true;

  return found;
end;
$$;

revoke all on function public.set_badminton_site_owner_credential(text)
  from public, anon;
grant execute on function public.set_badminton_site_owner_credential(text)
  to authenticated;

create or replace function public.get_badminton_workspace_admin_status(
  p_workspace_id uuid
)
returns table(
  workspace_id uuid,
  workspace_name text,
  member_role text,
  can_manage_coordinators boolean,
  owner_credential_set boolean
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  return query
  select
    w.id,
    w.name,
    wm.role,
    wm.role in ('owner', 'co-owner'),
    exists (
      select 1
      from public.badminton_site_owner_security security
      where security.singleton = true
        and security.credential_hash is not null
    )
  from public.badminton_workspaces w
  join public.badminton_workspace_members wm
    on wm.workspace_id = w.id
   and wm.user_id = (select auth.uid())
  where w.id = p_workspace_id;
end;
$$;

revoke all on function public.get_badminton_workspace_admin_status(uuid)
  from public, anon;
grant execute on function public.get_badminton_workspace_admin_status(uuid)
  to authenticated;

create or replace function public.list_manageable_badminton_workspace_access()
returns table(
  workspace_id uuid,
  workspace_name text,
  coordinator_email text,
  member_role text,
  joined_at timestamptz,
  caller_role text,
  owner_credential_set boolean
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.badminton_workspace_members caller_membership
    where caller_membership.user_id = (select auth.uid())
      and caller_membership.role in ('owner', 'co-owner')
  ) then
    raise exception 'Owner or Co-owner access required';
  end if;

  return query
  select
    w.id,
    w.name,
    lower(u.email),
    member.role,
    member.joined_at,
    caller.role,
    exists (
      select 1
      from public.badminton_site_owner_security security
      where security.singleton = true
        and security.credential_hash is not null
    )
  from public.badminton_workspace_members caller
  join public.badminton_workspaces w
    on w.id = caller.workspace_id
  join public.badminton_workspace_members member
    on member.workspace_id = w.id
  join auth.users u
    on u.id = member.user_id
  where caller.user_id = (select auth.uid())
    and caller.role in ('owner', 'co-owner')
    and u.email is not null
  order by w.created_at, lower(u.email);
end;
$$;

revoke all on function public.list_manageable_badminton_workspace_access()
  from public, anon;
grant execute on function public.list_manageable_badminton_workspace_access()
  to authenticated;

create or replace function public.list_badminton_coordinators_for_workspace(
  p_workspace_id uuid
)
returns table(
  email text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.badminton_workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner', 'co-owner')
  ) then
    raise exception 'Owner or Co-owner access required';
  end if;

  return query
  select c.email, c.created_at
  from public.badminton_coordinators c
  order by c.email;
end;
$$;

revoke all on function public.list_badminton_coordinators_for_workspace(uuid)
  from public, anon;
grant execute on function public.list_badminton_coordinators_for_workspace(uuid)
  to authenticated;

create or replace function public.promote_badminton_coowner(
  p_workspace_id uuid,
  p_email text,
  p_owner_credential text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_target_user_id uuid;
  v_hash text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.badminton_workspaces w
    where w.id = p_workspace_id
      and w.owner_id = (select auth.uid())
  ) then
    raise exception 'Only the workspace Owner can appoint Co-owners';
  end if;

  select security.credential_hash
  into v_hash
  from public.badminton_site_owner_security security
  where security.singleton = true;

  if v_hash is null then
    raise exception 'The Website Owner credential has not been set';
  end if;

  if extensions.crypt(
       coalesce(p_owner_credential, ''),
       v_hash
     ) <> v_hash
  then
    raise exception 'Owner credential is incorrect';
  end if;

  if not exists (
    select 1
    from public.badminton_coordinators c
    where c.email = v_email
  ) then
    raise exception 'The email must be an approved coordinator first';
  end if;

  select u.id
  into v_target_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_target_user_id is null then
    raise exception 'No Supabase Auth account exists for this coordinator';
  end if;

  if v_target_user_id = (select auth.uid()) then
    raise exception 'The workspace Owner is already the Owner';
  end if;

  insert into public.badminton_workspace_members(
    workspace_id,
    user_id,
    role
  )
  values (
    p_workspace_id,
    v_target_user_id,
    'co-owner'
  )
  on conflict (workspace_id, user_id)
  do update set role =
    case
      when public.badminton_workspace_members.role = 'owner'
        then 'owner'
      else 'co-owner'
    end;

  return true;
end;
$$;

revoke all on function public.promote_badminton_coowner(uuid, text, text)
  from public, anon;
grant execute on function public.promote_badminton_coowner(uuid, text, text)
  to authenticated;

create or replace function public.demote_badminton_coowner(
  p_workspace_id uuid,
  p_email text,
  p_owner_credential text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_target_user_id uuid;
  v_hash text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.badminton_workspaces w
    where w.id = p_workspace_id
      and w.owner_id = (select auth.uid())
  ) then
    raise exception 'Only the workspace Owner can demote Co-owners';
  end if;

  select security.credential_hash
  into v_hash
  from public.badminton_site_owner_security security
  where security.singleton = true;

  if v_hash is null then
    raise exception 'The Website Owner credential has not been set';
  end if;

  if extensions.crypt(
       coalesce(p_owner_credential, ''),
       v_hash
     ) <> v_hash
  then
    raise exception 'Owner credential is incorrect';
  end if;

  select u.id
  into v_target_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_target_user_id is null then
    raise exception 'Coordinator account not found';
  end if;

  if v_target_user_id = (select auth.uid()) then
    raise exception 'The workspace Owner cannot be demoted';
  end if;

  update public.badminton_workspace_members wm
  set role = 'coordinator'
  where wm.workspace_id = p_workspace_id
    and wm.user_id = v_target_user_id
    and wm.role = 'co-owner';

  return found;
end;
$$;

revoke all on function public.demote_badminton_coowner(uuid, text, text)
  from public, anon;
grant execute on function public.demote_badminton_coowner(uuid, text, text)
  to authenticated;

-- Owner and Co-owner can grant/remove normal coordinator workspace access.
create or replace function public.grant_badminton_workspace_access(
  p_workspace_id uuid,
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_target_user_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.badminton_workspace_members caller
    where caller.workspace_id = p_workspace_id
      and caller.user_id = (select auth.uid())
      and caller.role in ('owner', 'co-owner')
  ) then
    raise exception 'Owner or Co-owner access required';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));

  if not exists (
    select 1
    from public.badminton_coordinators c
    where c.email = v_email
  ) then
    raise exception 'The email must be an approved coordinator first';
  end if;

  select u.id
  into v_target_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_target_user_id is null then
    raise exception 'No Supabase Auth account exists for this coordinator';
  end if;

  insert into public.badminton_workspace_members(
    workspace_id,
    user_id,
    role
  )
  values (
    p_workspace_id,
    v_target_user_id,
    'coordinator'
  )
  on conflict (workspace_id, user_id)
  do update set role =
    case
      when public.badminton_workspace_members.role in ('owner', 'co-owner')
        then public.badminton_workspace_members.role
      else 'coordinator'
    end;

  return true;
end;
$$;

revoke all on function public.grant_badminton_workspace_access(uuid, text)
  from public, anon;
grant execute on function public.grant_badminton_workspace_access(uuid, text)
  to authenticated;

create or replace function public.revoke_badminton_workspace_access(
  p_workspace_id uuid,
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_target_user_id uuid;
  v_target_role text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.badminton_workspace_members caller
    where caller.workspace_id = p_workspace_id
      and caller.user_id = (select auth.uid())
      and caller.role in ('owner', 'co-owner')
  ) then
    raise exception 'Owner or Co-owner access required';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));

  select u.id
  into v_target_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_target_user_id is null then
    return false;
  end if;

  select wm.role
  into v_target_role
  from public.badminton_workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = v_target_user_id;

  if v_target_role = 'owner' then
    raise exception 'Workspace Owner access cannot be removed';
  end if;

  if v_target_role = 'co-owner' then
    raise exception 'Demote the Co-owner before removing workspace access';
  end if;

  delete from public.badminton_workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = v_target_user_id
    and wm.role = 'coordinator';

  return found;
end;
$$;

revoke all on function public.revoke_badminton_workspace_access(uuid, text)
  from public, anon;
grant execute on function public.revoke_badminton_workspace_access(uuid, text)
  to authenticated;

create or replace function public.remove_badminton_coordinator_authorized(
  p_workspace_id uuid,
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_target_user_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.badminton_workspace_members caller
    where caller.workspace_id = p_workspace_id
      and caller.user_id = (select auth.uid())
      and caller.role = 'owner'
  ) then
    raise exception 'Only a workspace Owner can remove a coordinator account';
  end if;

  if v_email = lower(coalesce((select auth.jwt() ->> 'email'), '')) then
    raise exception 'You cannot remove your own coordinator email';
  end if;

  select u.id
  into v_target_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_target_user_id is not null
     and exists (
       select 1
       from public.badminton_workspace_members wm
       where wm.user_id = v_target_user_id
     )
  then
    raise exception 'Remove this coordinator from all workspaces before removing the coordinator account';
  end if;

  delete from public.badminton_coordinators
  where email = v_email;

  return found;
end;
$$;

revoke all on function public.remove_badminton_coordinator_authorized(uuid, text)
  from public, anon;
grant execute on function public.remove_badminton_coordinator_authorized(uuid, text)
  to authenticated;

-- Disable older broad coordinator-management RPCs.
revoke execute on function public.list_badminton_coordinators()
  from authenticated;
revoke execute on function public.list_owned_badminton_workspace_access()
  from authenticated;
revoke execute on function public.remove_badminton_coordinator(text)
  from authenticated;


-- ============================================================
-- Owner / Co-owner privilege parity
-- ============================================================

create or replace function public.can_create_badminton_workspace()
returns boolean
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_email text;
begin
  if (select auth.uid()) is null then
    return false;
  end if;

  v_email := lower(coalesce((select auth.jwt() ->> 'email'), ''));

  if not exists (
    select 1
    from public.badminton_coordinators c
    where c.email = v_email
  ) then
    return false;
  end if;

  if not exists (
    select 1
    from public.badminton_workspaces
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.badminton_workspace_members wm
    where wm.user_id = (select auth.uid())
      and wm.role in ('owner', 'co-owner')
  );
end;
$$;

revoke all on function public.can_create_badminton_workspace()
  from public, anon;
grant execute on function public.can_create_badminton_workspace()
  to authenticated;

create or replace function public.create_badminton_workspace(
  p_name text
)
returns table(
  workspace_id uuid,
  join_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_code text;
  v_email text;
  v_workspace_count integer;
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

  select count(*)
  into v_workspace_count
  from public.badminton_workspaces;

  if v_workspace_count > 0
     and not exists (
       select 1
       from public.badminton_workspace_members wm
       where wm.user_id = (select auth.uid())
         and wm.role in ('owner', 'co-owner')
     )
  then
    raise exception 'Only an Owner or Co-owner can create a workspace';
  end if;

  loop
    v_code := upper(
      substr(
        md5(random()::text || clock_timestamp()::text),
        1,
        8
      )
    );

    exit when not exists (
      select 1
      from public.badminton_workspaces w
      where w.join_code = v_code
    );
  end loop;

  insert into public.badminton_workspaces(
    name,
    join_code,
    owner_id
  )
  values (
    coalesce(
      nullif(trim(p_name), ''),
      'Badminton Workspace'
    ),
    v_code,
    (select auth.uid())
  )
  returning id into v_workspace_id;

  insert into public.badminton_workspace_members(
    workspace_id,
    user_id,
    role
  )
  values (
    v_workspace_id,
    (select auth.uid()),
    'owner'
  );

  return query
  select v_workspace_id, v_code;
end;
$$;

revoke all on function public.create_badminton_workspace(text)
  from public, anon;
grant execute on function public.create_badminton_workspace(text)
  to authenticated;

create or replace function public.remove_badminton_coordinator_authorized(
  p_workspace_id uuid,
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_target_user_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.badminton_workspace_members caller
    where caller.workspace_id = p_workspace_id
      and caller.user_id = (select auth.uid())
      and caller.role in ('owner', 'co-owner')
  ) then
    raise exception 'Owner or Co-owner access required';
  end if;

  if v_email = lower(coalesce((select auth.jwt() ->> 'email'), '')) then
    raise exception 'You cannot remove your own coordinator email';
  end if;

  select u.id
  into v_target_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_target_user_id is not null
     and exists (
       select 1
       from public.badminton_workspace_members wm
       where wm.user_id = v_target_user_id
     )
  then
    raise exception 'Remove this coordinator from all workspaces before removing the coordinator account';
  end if;

  delete from public.badminton_coordinators
  where email = v_email;

  return found;
end;
$$;

revoke all on function public.remove_badminton_coordinator_authorized(uuid, text)
  from public, anon;
grant execute on function public.remove_badminton_coordinator_authorized(uuid, text)
  to authenticated;
