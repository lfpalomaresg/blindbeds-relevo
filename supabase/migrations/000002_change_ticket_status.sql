-- Cambio de estado de un parte de avería + traza en ticket_updates en UNA
-- sola transacción. Antes la app hacía dos llamadas sueltas (update y
-- insert): si fallaba la segunda, el parte quedaba cambiado sin historial.
--
-- security invoker: se ejecuta con los permisos del usuario, así que las
-- policies RLS de maintenance_tickets y ticket_updates siguen aplicando
-- (un parte de otra organización simplemente no se encuentra).
--
-- Devuelve true si el parte estaba en p_from y se ha cambiado a p_to; false si
-- no se encontró en ese estado (lista desfasada u otra organización). En ese
-- caso no se escribe nada. Una transición no permitida es un error (22023).

create or replace function public.change_ticket_status(p_ticket_id uuid, p_from text, p_to text)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rows integer;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Solo las transiciones que ofrece la app. Reabrir un parte cerrado, volver
  -- atrás o "cambiar" al mismo estado se rechaza aunque se llame directamente
  -- a la función (evita trazas ficticias y cierres incoherentes).
  if (p_from, p_to) not in (('abierto', 'en_curso'), ('abierto', 'cerrado'), ('en_curso', 'cerrado')) then
    raise exception 'invalid ticket status transition: % -> %', p_from, p_to using errcode = '22023';
  end if;

  update public.maintenance_tickets
     set status = p_to,
         closed_by = case when p_to = 'cerrado' then v_uid else closed_by end,
         closed_at = case when p_to = 'cerrado' then now() else closed_at end
   where id = p_ticket_id
     and status = p_from;

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
grant execute on function public.change_ticket_status(uuid, text, text) to authenticated;
