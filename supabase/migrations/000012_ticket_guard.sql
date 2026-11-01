-- Columnas protegidas del parte de avería.
--
-- Careo Codex 01/11/2026: la policy `tickets_update` (000001) deja a cualquier
-- miembro reescribir TODAS las columnas de un parte de su organización:
--   * photo_path → apuntar a una foto de otra org y dejar que el purgador
--     (service_role, scripts/purge-ticket-photos.mjs) la borre;
--   * created_by / closed_by → el UUID de un usuario de otra org, y leer su
--     email con ticket_author_emails() (000010).
--
-- Un trigger BEFORE INSERT OR UPDATE fija el contrato para los roles de la app (anon y
-- authenticated). Va en trigger y no en GRANT de columnas para que sobreviva a
-- un `grant all` manual (lo que pasó el 01/11).
--   * al crear: status 'abierto', sin closed_by/closed_at, created_by = auth.uid();
--   * inmutables: org_id, created_by, created_at, photo_path;
--   * cerrar exige closed_by = auth.uid() y closed_at = now() (lo que hace
--     change_ticket_status); un parte cerrado no se reabre ni se re-fecha;
--     en abierto/en_curso closed_by y closed_at van vacíos.
-- service_role y el propietario no pasan por estas reglas (el purgador vacía
-- photo_path). Ojo: tampoco las RPC security definer de 000013/000014, que
-- corren como propietario; el trigger es barrera frente a permisos de
-- escritura reabiertos para la app, no frente a un fallo dentro de esas RPC
-- (esas fijan ellas mismas los campos y las cubren sus tests).
--
-- Además: room_number recortado, no vacío y sin caracteres de control.
-- Idempotente.

create or replace function public.maintenance_tickets_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  -- INSERT (careo R3): un parte nace abierto, sin datos de cierre y a nombre de
  -- quien lo crea. Sin esto, un INSERT directo con status 'cerrado' y el
  -- closed_by de un usuario de otra org reabría la fuga de emails de 000010.
  if tg_op = 'INSERT' then
    if new.status is distinct from 'abierto'
       or new.closed_by is not null
       or new.closed_at is not null
       or new.created_by is distinct from auth.uid() then
      raise exception 'new tickets start open, without closure fields, created by the current user'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.org_id is distinct from old.org_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.photo_path is distinct from old.photo_path then
    raise exception 'protected ticket column (org_id, created_by, created_at, photo_path)'
      using errcode = '42501';
  end if;

  -- Coherencia del cierre (careo R2): status, closed_by y closed_at van juntos.
  if old.status = 'cerrado' then
    -- Cerrado es final: ni se reabre ni se cambian los datos del cierre.
    if new.status is distinct from 'cerrado'
       or new.closed_by is distinct from old.closed_by
       or new.closed_at is distinct from old.closed_at then
      raise exception 'closed ticket: status and closure fields are final' using errcode = '42501';
    end if;
  elsif new.status = 'cerrado' then
    -- Cerrar = quien ejecuta, ahora (lo que hace change_ticket_status).
    if new.closed_by is distinct from auth.uid()
       or new.closed_at is distinct from pg_catalog.now() then
      raise exception 'closing requires closed_by = auth.uid() and closed_at = now()' using errcode = '42501';
    end if;
  elsif new.closed_by is not null or new.closed_at is not null then
    raise exception 'closure fields only on closed tickets' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.maintenance_tickets_guard() from public, anon, authenticated;

drop trigger if exists maintenance_tickets_guard on public.maintenance_tickets;
create trigger maintenance_tickets_guard
  before insert or update on public.maintenance_tickets
  for each row execute function public.maintenance_tickets_guard();

-- La foto vive SIEMPRE bajo la carpeta de la org del parte, con el nombre que
-- genera la app (src/lib/validation.ts → buildPhotoPath). Cubre el INSERT, que
-- el trigger no ve: sin esto un miembro podía crear un parte con la foto de
-- otra org y el purgador la borraría a los 90 días.
alter table public.maintenance_tickets drop constraint if exists maintenance_tickets_photo_path_org;
alter table public.maintenance_tickets
  add constraint maintenance_tickets_photo_path_org
  check (
    photo_path is null
    or photo_path ~ ('^' || org_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
  ) not valid;

alter table public.maintenance_tickets drop constraint if exists maintenance_tickets_room_number_clean;
alter table public.maintenance_tickets
  add constraint maintenance_tickets_room_number_clean
  check (
    room_number is null
    or (room_number = pg_catalog.btrim(room_number)
        and room_number <> ''
        and room_number !~ '[[:cntrl:]]')
  ) not valid;

-- Los CHECK se crean NOT VALID (se aplican ya a toda escritura nueva) y se
-- validan sobre los datos existentes. Si hay filas antiguas no conformes, la
-- migración NO aborta: avisa y deja el CHECK sin validar para revisarlas con
--   select id, photo_path, room_number from public.maintenance_tickets
--    where not (... misma condición ...);
-- y después `alter table ... validate constraint ...`.
do $$
declare
  c text;
begin
  foreach c in array array['maintenance_tickets_photo_path_org', 'maintenance_tickets_room_number_clean'] loop
    begin
      execute pg_catalog.format('alter table public.maintenance_tickets validate constraint %I', c);
    exception when check_violation then
      raise warning 'constraint % left NOT VALID: existing rows do not comply; review them', c;
    end;
  end loop;
end
$$;
