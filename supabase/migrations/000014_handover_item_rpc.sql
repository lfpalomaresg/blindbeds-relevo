-- Pendientes del relevo solo por RPC (careo RPC R1, 02/11/2026).
--
-- La policy handover_items_update (000001) dejaba a cualquier miembro reescribir
-- cualquier columna de cualquier ítem de su hotel: el contenido de un relevo
-- ajeno, o atribuir la resolución a otra persona (resolved_by = otro UUID). La
-- app solo marca como resuelto, así que:
--   * resolve_handover_item(id) fija resolved = true, resolved_by = auth.uid()
--     y resolved_at = now(), solo si no estaba resuelto y es de un hotel activo
--     del usuario; devuelve true/false;
--   * create_handover (000006) pasa a security definer con membresía explícita
--     (careo RPC R2: el INSERT directo permitía ítems pre-resueltos a nombre de
--     otro o en el relevo de otra persona);
--   * anon y authenticated pierden INSERT/UPDATE/DELETE en shift_handovers y
--     handover_items: crear = create_handover, resolver = resolve_handover_item.
-- Idempotente.

create or replace function public.resolve_handover_item(p_item_id uuid)
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

  update public.handover_items
     set resolved = true,
         resolved_by = v_uid,
         resolved_at = pg_catalog.now()
   where id = p_item_id
     and resolved = false
     and org_id in (select o from public.get_user_org_ids() as o);

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke execute on function public.resolve_handover_item(uuid) from public, anon, service_role;
grant execute on function public.resolve_handover_item(uuid) to authenticated;

-- create_handover: mismo contrato que 000006, ahora definer. Los ítems nacen
-- sin resolver (solo se toman block y content del JSON).
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

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_items) as e(item)
     where pg_catalog.jsonb_typeof(e.item) <> 'object'
        or pg_catalog.jsonb_typeof(e.item -> 'content') is distinct from 'string'
        or pg_catalog.btrim(e.item ->> 'content') = ''
  ) then
    raise exception 'every handover item needs non-empty content' using errcode = '22023';
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

revoke insert, update, delete on public.shift_handovers from anon, authenticated;
revoke insert, update, delete on public.handover_items from anon, authenticated;
