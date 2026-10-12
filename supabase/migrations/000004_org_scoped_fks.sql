-- Blindbeds Relevo — organization-scoped (composite) foreign keys
--
-- Problem: the baseline's simple FKs only require the referenced row to exist,
-- not to belong to the same organization. RLS checks the org_id of the NEW row,
-- never the one of the row it points to, so a member of org A who guessed a
-- UUID from org B could attach
--   * a handover_item (org A) to a shift_handover of org B, or
--   * a maintenance_ticket (org A) to a ticket_asset of org B.
--
-- Fix: `unique (id, org_id)` on each parent and a composite FK
-- `(parent_id, org_id)` on each child. The database itself now rejects the
-- cross-org reference with 23503 for every role, service_role included.
--
--   handover_items      (handover_id, org_id) -> shift_handovers     (id, org_id)  on delete cascade
--   maintenance_tickets (asset_id,    org_id) -> ticket_assets       (id, org_id)  [asset_id stays nullable]
--   ticket_updates      (ticket_id,   org_id) -> maintenance_tickets (id, org_id)  on delete cascade
--
-- ticket_updates had no org_id: it is added, backfilled from its ticket and
-- kept in sync by a BEFORE INSERT trigger, so clients may keep omitting it.
--
-- Idempotent: every step is guarded. Apply it in a single transaction (the
-- setup script does): if it aborts, nothing is left half-applied.
--
-- Existing data: rows that ALREADY cross organizations cannot be repaired
-- automatically without guessing which side is right (and re-tagging them
-- could expose one organization's data to another), so the migration aborts
-- with an explicit message instead of rewriting them.

-- ─── 0. Refuse to run over data that already crosses organizations ───
do $$
declare
  n_items bigint;
  n_tickets bigint;
begin
  select count(*) into n_items
  from public.handover_items i
  join public.shift_handovers h on h.id = i.handover_id
  where i.org_id <> h.org_id;

  select count(*) into n_tickets
  from public.maintenance_tickets t
  join public.ticket_assets a on a.id = t.asset_id
  where t.org_id <> a.org_id;

  if n_items > 0 or n_tickets > 0 then
    raise exception
      'cross-organization references found: % handover_items point to a handover of another org, % maintenance_tickets point to an asset of another org',
      n_items, n_tickets
      using hint = 'Review and fix those rows by hand (see docs/20_ACTIVACION_SUPABASE.md), then re-run 000004_org_scoped_fks.sql.';
  end if;
end
$$;

-- ─── 1. Parents: (id, org_id) must be referenceable ───
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shift_handovers'::regclass and conname = 'shift_handovers_id_org_id_key'
  ) then
    alter table public.shift_handovers
      add constraint shift_handovers_id_org_id_key unique (id, org_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ticket_assets'::regclass and conname = 'ticket_assets_id_org_id_key'
  ) then
    alter table public.ticket_assets
      add constraint ticket_assets_id_org_id_key unique (id, org_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.maintenance_tickets'::regclass and conname = 'maintenance_tickets_id_org_id_key'
  ) then
    alter table public.maintenance_tickets
      add constraint maintenance_tickets_id_org_id_key unique (id, org_id);
  end if;
end
$$;

-- ─── 2. ticket_updates.org_id, derived from its ticket ───
alter table public.ticket_updates
  add column if not exists org_id uuid references public.organizations(id);

update public.ticket_updates u
set org_id = t.org_id
from public.maintenance_tickets t
where t.id = u.ticket_id
  and u.org_id is null;

alter table public.ticket_updates
  alter column org_id set not null;

-- Clients do not send org_id: inherit it from the ticket when omitted. If a
-- caller does send one, it is left untouched and the composite FK validates it.
-- SECURITY INVOKER on purpose: a user who cannot see the ticket gets no org_id
-- and is rejected by the insert policy (42501) before any constraint is checked.
create or replace function public.ticket_updates_set_org_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.org_id is null then
    select t.org_id into new.org_id
    from public.maintenance_tickets t
    where t.id = new.ticket_id;
  end if;
  return new;
end
$$;

drop trigger if exists ticket_updates_set_org_id on public.ticket_updates;
create trigger ticket_updates_set_org_id
  before insert on public.ticket_updates
  for each row execute function public.ticket_updates_set_org_id();

-- ─── 3. Children: composite FKs ───
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.handover_items'::regclass and conname = 'handover_items_handover_org_fkey'
  ) then
    alter table public.handover_items
      add constraint handover_items_handover_org_fkey
      foreign key (handover_id, org_id)
      references public.shift_handovers (id, org_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.maintenance_tickets'::regclass and conname = 'maintenance_tickets_asset_org_fkey'
  ) then
    -- MATCH SIMPLE (default): a ticket without asset (asset_id null) is not checked.
    alter table public.maintenance_tickets
      add constraint maintenance_tickets_asset_org_fkey
      foreign key (asset_id, org_id)
      references public.ticket_assets (id, org_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ticket_updates'::regclass and conname = 'ticket_updates_ticket_org_fkey'
  ) then
    alter table public.ticket_updates
      add constraint ticket_updates_ticket_org_fkey
      foreign key (ticket_id, org_id)
      references public.maintenance_tickets (id, org_id)
      on delete cascade;
  end if;
end
$$;

-- ─── 4. The simple FKs are now implied by the composite ones ───
alter table public.handover_items drop constraint if exists handover_items_handover_id_fkey;
alter table public.maintenance_tickets drop constraint if exists maintenance_tickets_asset_id_fkey;
alter table public.ticket_updates drop constraint if exists ticket_updates_ticket_id_fkey;

-- ─── 5. Index for the cascade from shift_handovers to its items ───
create index if not exists handover_items_handover_idx on public.handover_items (handover_id);
