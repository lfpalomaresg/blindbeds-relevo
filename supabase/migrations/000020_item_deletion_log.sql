-- Vista de solo lectura del rastro de borrados para el admin (000018).
--
-- handover_item_deletions guarda quién borró un bloque del relevo y cuándo,
-- con deleted_by como uuid de auth.users, que el cliente no puede leer. Esta
-- migración crea public.handover_item_deletion_log(p_org_id), que devuelve
-- para la pantalla /handover:
--   deleted_at, deleted_by_email, handover_id, handover_created_at,
--   department, shift_type, block
-- NUNCA el contenido borrado: handover_item_deletions no lo guarda y la
-- función no lee handover_items.
--
-- Quién la usa: solo el admin de un hotel activo, y solo de su hotel. La
-- comprobación es la misma que la policy de lectura de 000018
-- (get_user_org_ids() + has_org_role(org, 'admin')), repetida aquí porque la
-- función es security definer (necesita auth.users) y no pasa por RLS. A
-- cualquier otro (staff, supervisor, otro hotel, hotel suspendido) le
-- devuelve cero filas.
--
-- Datos del relevo (fecha, departamento, turno) por left join: si la
-- retención de 90 días (000008) ya borró el relevo, salen vacíos y el asiento
-- sigue. Email por left join: si el usuario ya no existe, sale vacío.
-- Como mucho las 200 filas más recientes.
--
-- security definer, stable, search_path vacío y todo cualificado por esquema.
-- EXECUTE solo para authenticated (ni PUBLIC, ni anon, ni service_role).
-- Idempotente. Tras reaplicar 000011 (que concede execute en todas las
-- funciones), reaplicar también esta para retirarlo de nuevo a anon.

create or replace function public.handover_item_deletion_log(p_org_id uuid)
returns table (
  deleted_at timestamptz,
  deleted_by_email text,
  handover_id uuid,
  handover_created_at timestamptz,
  department text,
  shift_type text,
  block text
)
language sql
security definer
stable
set search_path = ''
as $$
  select d.deleted_at,
         u.email::pg_catalog.text,
         d.handover_id,
         h.created_at,
         h.department,
         h.shift_type,
         d.block
    from public.handover_item_deletions d
    left join public.shift_handovers h
      on h.id = d.handover_id
     and h.org_id = d.org_id
    left join auth.users u
      on u.id = d.deleted_by
   where d.org_id = p_org_id
     and p_org_id in (select o from public.get_user_org_ids() as o)
     and public.has_org_role(p_org_id, 'admin')
   order by d.deleted_at desc
   limit 200;
$$;

revoke execute on function public.handover_item_deletion_log(uuid) from public, anon, service_role;
grant execute on function public.handover_item_deletion_log(uuid) to authenticated;
