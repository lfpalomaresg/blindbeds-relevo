-- Blindbeds Relevo — módulos propios sobre proyecto APPCC/Audit compartido
-- organizations, memberships, get_user_org_ids() y has_org_role()
-- YA existen (migración 000001 de APPCC). Esta migración solo añade
-- las 5 tablas de Relevo + RLS + bucket de fotos.

-- ═══ Módulo 1: Handover de turno (FR-005) ═══

create table public.shift_handovers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  department text not null check (department in ('recepcion', 'pisos', 'fb', 'mantenimiento', 'otro')),
  shift_type text not null check (shift_type in ('manana', 'tarde', 'noche')),
  created_by uuid not null references auth.users(id),
  read_by uuid references auth.users(id),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index shift_handovers_org_idx on public.shift_handovers(org_id, created_at desc);

create table public.handover_items (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.shift_handovers(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  block text not null check (block in ('pendientes', 'vips', 'incidencias', 'avisos')),
  content text not null,
  resolved boolean not null default false,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index handover_items_pending_idx on public.handover_items(org_id, resolved, created_at desc);

-- ═══ Módulo 2: Partes de avería (FR-006) ═══

create table public.ticket_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  location text,
  qr_code text not null unique,
  created_at timestamptz not null default now()
);

create index ticket_assets_org_idx on public.ticket_assets(org_id);

create table public.maintenance_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  asset_id uuid references public.ticket_assets(id),
  title text not null,
  description text,
  priority text not null default 'normal' check (priority in ('critica', 'alta', 'normal', 'baja')),
  status text not null default 'abierto' check (status in ('abierto', 'en_curso', 'cerrado')),
  photo_path text,
  created_by uuid not null references auth.users(id),
  assigned_to uuid references auth.users(id),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create index maintenance_tickets_org_idx on public.maintenance_tickets(org_id, status, created_at desc);
create index maintenance_tickets_asset_idx on public.maintenance_tickets(asset_id, created_at desc);

create table public.ticket_updates (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.maintenance_tickets(id) on delete cascade,
  status_from text,
  status_to text not null,
  comment text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index ticket_updates_ticket_idx on public.ticket_updates(ticket_id, created_at desc);

-- ═══ RLS ═══

alter table public.shift_handovers enable row level security;
alter table public.handover_items enable row level security;
alter table public.ticket_assets enable row level security;
alter table public.maintenance_tickets enable row level security;
alter table public.ticket_updates enable row level security;

-- shift_handovers: cualquier miembro de la org puede crear/leer
create policy handovers_select on public.shift_handovers
  for select using (org_id in (select public.get_user_org_ids()));

create policy handovers_insert on public.shift_handovers
  for insert with check (org_id in (select public.get_user_org_ids()) and created_by = auth.uid());

-- handover_items: heredan el org_id del handover
create policy handover_items_select on public.handover_items
  for select using (org_id in (select public.get_user_org_ids()));

create policy handover_items_insert on public.handover_items
  for insert with check (org_id in (select public.get_user_org_ids()));

create policy handover_items_update on public.handover_items
  for update using (org_id in (select public.get_user_org_ids()))
  with check (org_id in (select public.get_user_org_ids()));

-- ticket_assets: todos pueden ver, admin gestiona
create policy assets_select on public.ticket_assets
  for select using (org_id in (select public.get_user_org_ids()));

create policy assets_admin_manage on public.ticket_assets
  for all using (org_id in (select public.get_user_org_ids()) and public.has_org_role(org_id, 'admin'))
  with check (org_id in (select public.get_user_org_ids()) and public.has_org_role(org_id, 'admin'));

-- maintenance_tickets
create policy tickets_select on public.maintenance_tickets
  for select using (org_id in (select public.get_user_org_ids()));

create policy tickets_insert on public.maintenance_tickets
  for insert with check (org_id in (select public.get_user_org_ids()) and created_by = auth.uid());

create policy tickets_update on public.maintenance_tickets
  for update using (org_id in (select public.get_user_org_ids()))
  with check (org_id in (select public.get_user_org_ids()));

-- ticket_updates
create policy updates_select on public.ticket_updates
  for select using (
    exists (select 1 from public.maintenance_tickets t where t.id = ticket_id and t.org_id in (select public.get_user_org_ids()))
  );

create policy updates_insert on public.ticket_updates
  for insert with check (
    created_by = auth.uid()
    and exists (select 1 from public.maintenance_tickets t where t.id = ticket_id and t.org_id in (select public.get_user_org_ids()))
  );

-- ═══ Storage bucket para fotos de averías ═══
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-photos', 'ticket-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;