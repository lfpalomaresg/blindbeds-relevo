-- Límites del relevo también en el servidor (pendiente bajo del careo RPC, 02/11/2026).
--
-- La UI (validateHandoverInput) ya limita el relevo a 4 bloques, un ítem por
-- bloque y 2000 caracteres por ítem, pero create_handover (000014) es una RPC
-- llamable con la anon key + sesión: sin estos límites, un miembro podía meter
-- cientos de ítems o textos enormes en un relevo. Mismo contrato que 000014
-- (security definer, membresía explícita, ítems sin resolver) más:
--   * como mucho 4 ítems;
--   * un ítem por bloque (block distinto);
--   * content de 1..2000 caracteres contados como la UI (String.length de JS,
--     unidades UTF-16): char_length + 1 por cada carácter fuera del BMP (emojis).
-- Errores: 22023 (invalid_parameter_value), como el resto de validaciones.
-- `create or replace` conserva las ACL de 000014. Idempotente.

create or replace function public.create_handover(
  p_org_id uuid,
  p_department text,
  p_shift_type text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_handover_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_org_id is null or p_org_id not in (select o from public.get_user_org_ids() as o) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' or pg_catalog.jsonb_array_length(p_items) = 0 then
    raise exception 'handover requires at least one item' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_items) > 4 then
    raise exception 'handover allows at most 4 items' using errcode = '22023';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_items) as e(item)
     where pg_catalog.jsonb_typeof(e.item) <> 'object'
        or pg_catalog.jsonb_typeof(e.item -> 'content') is distinct from 'string'
        or pg_catalog.btrim(e.item ->> 'content') = ''
  ) then
    raise exception 'every handover item needs non-empty content' using errcode = '22023';
  end if;

  -- Cota barata primero: un texto de > 2000 puntos de código ya pasa del
  -- límite y se rechaza sin recorrerlo carácter a carácter.
  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_items) as e(item)
     where pg_catalog.char_length(e.item ->> 'content') > 2000
  ) then
    raise exception 'handover item content must be at most 2000 characters' using errcode = '22023';
  end if;

  -- Ya acotados a 2000: contar como String.length (fuera del BMP = 2 unidades).
  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_items) as e(item)
     where pg_catalog.char_length(e.item ->> 'content')
           + (select pg_catalog.count(*)::integer
                from pg_catalog.regexp_split_to_table(e.item ->> 'content', '') as ch(c)
               where pg_catalog.ascii(ch.c) > 65535) > 2000
  ) then
    raise exception 'handover item content must be at most 2000 characters' using errcode = '22023';
  end if;

  if (select pg_catalog.count(distinct e.item ->> 'block') from pg_catalog.jsonb_array_elements(p_items) as e(item))
     <> pg_catalog.jsonb_array_length(p_items) then
    raise exception 'handover allows one item per block' using errcode = '22023';
  end if;

  insert into public.shift_handovers (org_id, department, shift_type, created_by)
  values (p_org_id, p_department, p_shift_type, v_uid)
  returning id into v_handover_id;

  insert into public.handover_items (handover_id, org_id, block, content)
  select v_handover_id, p_org_id, e.item ->> 'block', e.item ->> 'content'
    from pg_catalog.jsonb_array_elements(p_items) with ordinality as e(item, pos)
   order by e.pos;

  return v_handover_id;
end;
$$;

revoke execute on function public.create_handover(uuid, text, text, jsonb) from public, anon, service_role;
grant execute on function public.create_handover(uuid, text, text, jsonb) to authenticated;
