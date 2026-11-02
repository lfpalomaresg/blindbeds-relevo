-- Partes de avería SOLO por RPC.
--
-- Por qué (01/11/2026): tres rondas de careo encontraron tres huecos distintos
-- en la misma superficie — la app escribía maintenance_tickets y ticket_updates
-- directamente, con policies que no limitaban columnas ni estados (fuga de
-- emails entre orgs vía created_by/closed_by, borrado de fotos de otra org por
-- el purgador, cierres incoherentes). En vez de seguir acotando la escritura
-- directa, se retira:
--   * anon y authenticated pierden INSERT/UPDATE/DELETE en esas dos tablas
--     (SELECT y RLS de lectura no cambian);
--   * crear  = public.create_ticket(...)          (nuevo)
--   * estado = public.change_ticket_status(...)   (pasa a security definer)
-- Ambas comprueban la membresía activa con get_user_org_ids() y fijan ellas
-- mismas created_by / status / closed_by / closed_at. El trigger de 000012 y
-- los CHECK siguen como segunda barrera si alguien vuelve a abrir permisos.
-- Idempotente. Reaplicar después de 000011 si se reaplica esta.

-- 1. Crear parte -------------------------------------------------------------
create or replace function public.create_ticket(
  p_org_id uuid,
  p_title text,
  p_description text,
  p_priority text,
  p_asset_id uuid,
  p_room_number text,
  p_photo_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_description text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_org_id is null or p_org_id not in (select o from public.get_user_org_ids() as o) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  -- Mismos límites que la app (src/lib/validation.ts → LIMITS).
  if v_title = '' or pg_catalog.char_length(v_title) > 120 then
    raise exception 'title must be 1..120 characters' using errcode = '22023';
  end if;
  if v_description is not null and pg_catalog.char_length(v_description) > 2000 then
    raise exception 'description must be at most 2000 characters' using errcode = '22023';
  end if;
  -- La foto la ha subido quien crea el parte y hace menos de 12 h (careo RPC
  -- R1). Así nadie enlaza la foto de otro ni una antigua, y el barrido de
  -- huérfanas (> 24 h, scripts/purge-ticket-photos.mjs) no puede competir con
  -- un parte que empieza a referenciarla. El índice único impide reutilizarla.
  if p_photo_path is not null and not exists (
    select 1 from storage.objects so
     where so.bucket_id = 'ticket-photos'
       and so.name = p_photo_path
       and so.owner_id = v_uid::text
       and so.created_at > pg_catalog.now() - interval '12 hours'
  ) then
    raise exception 'photo not found, not yours or too old' using errcode = '42501';
  end if;

  -- org_id, created_by, status y cierre los fija la función. Los CHECK de
  -- prioridad, room_number y ruta de foto (000012) y la FK compuesta del activo
  -- (000004: mismo org) siguen aplicando.
  insert into public.maintenance_tickets
    (org_id, title, description, priority, asset_id, room_number, photo_path, status, created_by)
  values
    (p_org_id, v_title, v_description, coalesce(p_priority, 'normal'), p_asset_id,
     p_room_number, p_photo_path, 'abierto', v_uid)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_ticket(uuid, text, text, text, uuid, text, text) from public, anon, service_role;
grant execute on function public.create_ticket(uuid, text, text, text, uuid, text, text) to authenticated;

create unique index if not exists maintenance_tickets_photo_path_key
  on public.maintenance_tickets (photo_path) where photo_path is not null;

-- 2. Cambiar estado (antes security invoker, dependía del UPDATE directo) -------
create or replace function public.change_ticket_status(p_ticket_id uuid, p_from text, p_to text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rows integer;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Solo las transiciones que ofrece la app (igual que 000005).
  if (p_from, p_to) not in (('abierto', 'en_curso'), ('abierto', 'cerrado'), ('en_curso', 'cerrado')) then
    raise exception 'invalid ticket status transition: % -> %', p_from, p_to using errcode = '22023';
  end if;

  -- Membresía explícita: como definer no pasa por RLS. Un parte de otra org o
  -- de una org suspendida se comporta como «no está en ese estado» (false).
  update public.maintenance_tickets
     set status = p_to,
         closed_by = case when p_to = 'cerrado' then v_uid else closed_by end,
         closed_at = case when p_to = 'cerrado' then pg_catalog.now() else closed_at end
   where id = p_ticket_id
     and status = p_from
     and org_id in (select o from public.get_user_org_ids() as o);

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;

  insert into public.ticket_updates (ticket_id, status_from, status_to, created_by)
  values (p_ticket_id, p_from, p_to, v_uid);

  return true;
end;
$$;

revoke execute on function public.change_ticket_status(uuid, text, text) from public, anon;
grant execute on function public.change_ticket_status(uuid, text, text) to authenticated, service_role;

-- 3. Sin escritura directa ----------------------------------------------------
revoke insert, update, delete on public.maintenance_tickets from anon, authenticated;
revoke insert, update, delete on public.ticket_updates from anon, authenticated;
