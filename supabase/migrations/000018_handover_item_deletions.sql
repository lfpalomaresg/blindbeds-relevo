-- Rastro de los borrados de ítems del relevo (trazabilidad de 000016, 10/11/2026).
--
-- delete_handover_item (000016) deja al admin del hotel borrar un ítem con un
-- dato sensible. Sin rastro, no queda constancia de quién borró qué ni cuándo.
-- Esta migración:
--   * crea public.handover_item_deletions: org_id, handover_id, item_id, block,
--     deleted_by y deleted_at. NO guarda el contenido borrado (el objetivo del
--     borrado es que ese texto desaparezca);
--   * handover_id e item_id sin clave foránea: la fila sobrevive al borrado del
--     relevo por la retención de 90 días (000008); org_id sí la tiene (si se
--     elimina el hotel, se elimina su rastro);
--   * RLS: solo lectura para el admin de un hotel activo, y solo de su hotel;
--     la app no escribe, cambia ni borra filas (sin INSERT/UPDATE/DELETE);
--   * redefine delete_handover_item para que escriba la fila en la misma
--     transacción que el borrado; mismo contrato que 000016 (true/false, no
--     revela si el ítem existe). Los intentos que no borran no dejan fila.
-- Idempotente. Tras reaplicar 000011 (que concede escritura en todas las
-- tablas), reaplicar también esta para retirar la escritura de la app.

create table if not exists public.handover_item_deletions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  handover_id uuid not null,
  item_id uuid not null,
  block text not null,
  deleted_by uuid not null,
  deleted_at timestamptz not null default now()
);

create index if not exists handover_item_deletions_org_deleted_at_idx
  on public.handover_item_deletions (org_id, deleted_at desc);

alter table public.handover_item_deletions enable row level security;

drop policy if exists handover_item_deletions_select_admin on public.handover_item_deletions;
create policy handover_item_deletions_select_admin on public.handover_item_deletions
  for select to authenticated
  using (org_id in (select public.get_user_org_ids()) and public.has_org_role(org_id, 'admin'));

revoke all on public.handover_item_deletions from anon;
revoke insert, update, delete, truncate on public.handover_item_deletions from authenticated;
grant select on public.handover_item_deletions to authenticated;

create or replace function public.delete_handover_item(p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_handover_id uuid;
  v_block text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  delete from public.handover_items i
   where i.id = p_item_id
     and i.org_id in (select o from public.get_user_org_ids() as o)
     and public.has_org_role(i.org_id, 'admin')
  returning i.org_id, i.handover_id, i.block into v_org_id, v_handover_id, v_block;

  if v_org_id is null then
    return false;
  end if;

  insert into public.handover_item_deletions (org_id, handover_id, item_id, block, deleted_by)
  values (v_org_id, v_handover_id, p_item_id, v_block, v_uid);

  return true;
end;
$$;

revoke execute on function public.delete_handover_item(uuid) from public, anon, service_role;
grant execute on function public.delete_handover_item(uuid) to authenticated;
