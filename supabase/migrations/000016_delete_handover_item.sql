-- Borrado manual de un ítem del relevo por el admin del hotel (MUST de
-- minimización del MVP, 10/11/2026).
--
-- Si en el texto libre de un relevo se cuela un dato sensible (nombre de un
-- huésped, dato de salud…), el admin del hotel debe poder borrar ese ítem sin
-- esperar a la retención de 90 días (000008). Procedimiento de incidente:
-- docs/30_RUNBOOK_OPERACION.md.
--
-- delete_handover_item(id):
--   * security definer, search_path vacío; exige sesión (auth.uid());
--   * borra solo si quien llama es admin (has_org_role) de un hotel ACTIVO
--     (get_user_org_ids) al que pertenece el ítem;
--   * devuelve true si borró y false en cualquier otro caso (no existe, no es
--     admin, otro hotel, hotel inactivo): no revela si el ítem existe;
--   * la cabecera del relevo se conserva (queda constancia de que hubo relevo).
-- La app sigue sin DELETE directo en handover_items (000014). Idempotente.

create or replace function public.delete_handover_item(p_item_id uuid)
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

  delete from public.handover_items i
   where i.id = p_item_id
     and i.org_id in (select o from public.get_user_org_ids() as o)
     and public.has_org_role(i.org_id, 'admin');

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke execute on function public.delete_handover_item(uuid) from public, anon, service_role;
grant execute on function public.delete_handover_item(uuid) to authenticated;
