begin;

create schema if not exists knox_private;
revoke all on schema knox_private from public, anon, authenticated;

create table if not exists knox_private.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('member', 'admin'))
);

create or replace function public.knox_role()
returns text language sql stable security definer set search_path = ''
as $$
  select role from knox_private.members where user_id = (select auth.uid()) and role = 'admin'
$$;
revoke all on function public.knox_role() from public, anon, authenticated;
grant execute on function public.knox_role() to authenticated;

create or replace function knox_private.valid_players(names text[])
returns boolean language sql immutable set search_path = ''
as $$
  select cardinality(names) <= 50 and not exists (
    select 1 from unnest(names) as p(name)
    where name is null or char_length(btrim(name)) not between 1 and 80
  )
$$;

create table if not exists public.knox_markers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  x integer not null check (x between 0 and 19967),
  y integer not null check (y between 0 and 16127),
  faction text not null check (char_length(btrim(faction)) between 1 and 80),
  players text[] not null check (knox_private.valid_players(players)),
  color text not null default '#c5d595' check (color ~ '^#[0-9a-fA-F]{6}$'),
  version integer not null default 1,
  updated_at timestamptz not null default clock_timestamp()
);

create or replace function knox_private.marker_write()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(665129, 1);
    if (select count(*) from public.knox_markers) >= 2000 then
      raise exception 'The board is full (2000 markers).';
    end if;
  else
    new.version := old.version + 1;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end
$$;
drop trigger if exists knox_marker_write on public.knox_markers;
create trigger knox_marker_write before insert or update on public.knox_markers
for each row execute function knox_private.marker_write();

alter table public.knox_markers enable row level security;
revoke all on public.knox_markers from public, anon, authenticated;
grant select on public.knox_markers to anon, authenticated;
grant insert (x, y, faction, players, color), update (faction, players, color), delete
  on public.knox_markers to authenticated;

drop policy if exists knox_view on public.knox_markers;
create policy knox_view on public.knox_markers for select to anon, authenticated using (true);
drop policy if exists knox_add on public.knox_markers;
create policy knox_add on public.knox_markers for insert to authenticated
  with check ((select public.knox_role()) = 'admin' and owner_id = (select auth.uid()));
drop policy if exists knox_edit on public.knox_markers;
create policy knox_edit on public.knox_markers for update to authenticated
  using ((select public.knox_role()) = 'admin')
  with check ((select public.knox_role()) = 'admin');
drop policy if exists knox_delete on public.knox_markers;
create policy knox_delete on public.knox_markers for delete to authenticated
  using ((select public.knox_role()) = 'admin');

create or replace function knox_private.backup_token(payload jsonb)
returns text language sql stable set search_path = ''
as $$
  select md5(jsonb_build_array(payload, coalesce(
    (select jsonb_agg(jsonb_build_array(id, version) order by id) from public.knox_markers),
    '[]'::jsonb
  ))::text)
$$;

create or replace function public.knox_restore(payload jsonb, expected_token text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actual_token text;
  incoming_count integer;
begin
  if public.knox_role() is distinct from 'admin' then
    raise exception 'Only a board admin can restore backups.' using errcode = '42501';
  end if;
  if payload->'format' is distinct from '"knox-field-map"'::jsonb
    or payload->'version' is distinct from '1'::jsonb
    or jsonb_typeof(payload->'markers') is distinct from 'array' then
    raise exception 'Choose a supported Knox Field Map backup file.';
  end if;
  incoming_count := jsonb_array_length(payload->'markers');
  if incoming_count > 2000 then
    raise exception 'A backup can contain at most 2000 markers.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(payload->'markers') as m(x integer, y integer, faction text, players text[], color text)
    where x is null or x not between 0 and 19967 or y is null or y not between 0 and 16127
      or faction is null or char_length(btrim(faction)) not between 1 and 80
      or players is null or not knox_private.valid_players(players)
      or (color is not null and color !~ '^#[0-9a-fA-F]{6}$')
  ) then
    raise exception 'The backup contains an invalid marker.';
  end if;
  if expected_token is null then
    return (select jsonb_build_object('currentCount', count(*), 'incomingCount', incoming_count,
      'token', knox_private.backup_token(payload)) from public.knox_markers);
  end if;
  lock table public.knox_markers in share row exclusive mode;
  actual_token := knox_private.backup_token(payload);
  if expected_token is distinct from actual_token then
    raise exception 'The board or backup changed. Review the restore again.' using errcode = 'PT409';
  end if;
  delete from public.knox_markers;
  -- Backups omit account IDs; restored markers are editable only by admins.
  insert into public.knox_markers (owner_id, x, y, faction, players, color)
    select null, x, y, btrim(faction), players, lower(coalesce(color, '#c5d595'))
    from jsonb_to_recordset(payload->'markers') as m(x integer, y integer, faction text, players text[], color text);
  return jsonb_build_object('count', incoming_count);
end
$$;
revoke all on function public.knox_restore(jsonb, text) from public, anon, authenticated;
grant execute on function public.knox_restore(jsonb, text) to authenticated;

create table if not exists knox_private.marker_submissions (
  id uuid primary key default gen_random_uuid(),
  x integer not null check (x between 0 and 19967),
  y integer not null check (y between 0 and 16127),
  faction text not null check (char_length(btrim(faction)) between 1 and 80),
  players text[] not null check (knox_private.valid_players(players)),
  color text not null check (color ~ '^#[0-9a-f]{6}$'),
  submitted_at timestamptz not null default clock_timestamp()
);
alter table knox_private.marker_submissions enable row level security;
revoke all on knox_private.marker_submissions from public, anon, authenticated;

create or replace function public.knox_submit_marker(x integer, y integer, faction text, players text[], color text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if x is null or x not between 0 and 19967 or y is null or y not between 0 and 16127
    or faction is null or char_length(btrim(faction)) not between 1 and 80
    or players is null or not knox_private.valid_players(players)
    or color is null or color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Enter valid coordinates, a faction name, up to 50 valid player names, and a color.';
  end if;
  perform pg_advisory_xact_lock(665129, 2);
  if (select count(*) from knox_private.marker_submissions) >= 200 then
    raise exception 'The review queue is full. Try again after the owner reviews some submissions.';
  end if;
  insert into knox_private.marker_submissions (x, y, faction, players, color)
    values (x, y, btrim(faction), players, lower(color));
end
$$;
revoke all on function public.knox_submit_marker(integer, integer, text, text[], text) from public, anon, authenticated;
grant execute on function public.knox_submit_marker(integer, integer, text, text[], text) to anon, authenticated;

create or replace function public.knox_pending_markers()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if public.knox_role() is distinct from 'admin' then
    raise exception 'Only a board admin can view pending markers.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(s order by s.submitted_at, s.id), '[]'::jsonb)
    from knox_private.marker_submissions s);
end
$$;
revoke all on function public.knox_pending_markers() from public, anon, authenticated;
grant execute on function public.knox_pending_markers() to authenticated;

create or replace function public.knox_review_marker(submission_id uuid, approve boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  submission knox_private.marker_submissions%rowtype;
begin
  if public.knox_role() is distinct from 'admin' then
    raise exception 'Only a board admin can review pending markers.' using errcode = '42501';
  end if;
  if approve is null then
    raise exception 'Choose whether to approve or reject the submission.';
  end if;
  delete from knox_private.marker_submissions where id = submission_id returning * into submission;
  if not found then
    raise exception 'This marker has already been reviewed.' using errcode = 'PT409';
  end if;
  if approve then
    insert into public.knox_markers (x, y, faction, players, color)
      values (submission.x, submission.y, submission.faction, submission.players, submission.color);
  end if;
end
$$;
revoke all on function public.knox_review_marker(uuid, boolean) from public, anon, authenticated;
grant execute on function public.knox_review_marker(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
