-- Relevo de turno (cabecera + items) en UNA sola transacción. Antes la app
-- hacía dos inserts sueltos (shift_handovers y luego handover_items): si
-- fallaba el segundo, quedaba una cabecera de relevo sin items.
--
-- security invoker: se ejecuta con los permisos del usuario, así que las
-- policies RLS de shift_handovers y handover_items siguen aplicando (crear un
-- relevo en otra organización falla con 42501 y no deja nada).
--
-- p_items: lista JSON de objetos {block, content}. Debe tener al menos un
-- elemento; un contenido vacío o ausente es 22023 y un bloque fuera de
-- catálogo viola el check de la tabla (23514). En cualquier error la llamada
-- entera se revierte: ni cabecera ni items.
--
-- Devuelve el id del relevo creado.

create or replace function public.create_handover(
  p_org_id uuid,
  p_department text,
  p_shift_type text,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_handover_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'handover requires at least one item' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_items) as e(item)
     where jsonb_typeof(e.item) <> 'object'
        or jsonb_typeof(e.item -> 'content') is distinct from 'string'
        or btrim(e.item ->> 'content') = ''
  ) then
    raise exception 'every handover item needs non-empty content' using errcode = '22023';
  end if;

  insert into public.shift_handovers (org_id, department, shift_type, created_by)
  values (p_org_id, p_department, p_shift_type, v_uid)
  returning id into v_handover_id;

  insert into public.handover_items (handover_id, org_id, block, content)
  select v_handover_id, p_org_id, e.item ->> 'block', e.item ->> 'content'
    from jsonb_array_elements(p_items) with ordinality as e(item, pos)
   order by e.pos;

  return v_handover_id;
end;
$$;

revoke execute on function public.create_handover(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_handover(uuid, text, text, jsonb) to authenticated;
