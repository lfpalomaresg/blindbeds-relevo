-- Idempotencia de create_handover (doble clic / reintento tras respuesta perdida).
--
-- Cada llamada insertaba un relevo nuevo: dos envios identicos (doble clic, o
-- reintento porque se perdio la respuesta) dejaban DOS relevos. Ahora la app manda
-- una clave UUID estable por intento. Si la clave ya existe para ese hotel se
-- compara el autor y el contenido (departamento, turno e items normalizados) contra
-- el relevo YA GUARDADO:
--   - mismo autor + mismo contenido -> se devuelve el relevo ya creado (no duplica);
--   - clave con otra peticion u otro autor -> error 22000 (no se descarta en silencio).
-- NO se guarda contenido ni huella del contenido: la comparacion se hace contra
-- handover_items (que 000018 puede borrar). Asi, borrar un item elimina su texto y no
-- queda un hash recuperable de el.
--
-- Se anade una funcion NUEVA `create_handover_idempotent` (5 args). NO se toca
-- `create_handover` de 4 args, que 000011 referencia por firma (un overload dejaria
-- las llamadas de 4 args ambiguas). La app usa la nueva. Idempotente.

alter table public.shift_handovers
  add column if not exists idempotency_key uuid;

-- Indice parcial: solo las claves no nulas participan. Varios NULL conviven.
create unique index if not exists shift_handovers_org_idempotency_key_key
  on public.shift_handovers (org_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.create_handover_idempotent(
  p_org_id uuid,
  p_department text,
  p_shift_type text,
  p_items jsonb,
  p_idempotency_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_handover_id uuid;
  v_autor_previo uuid;
  v_dep_previo text;
  v_turno_previo text;
  v_items_in jsonb;
  v_items_previo jsonb;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_org_id is null or p_org_id not in (select o from public.get_user_org_ids() as o) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  -- Canonico de la peticion entrante: items ordenados por bloque (null si no es lista).
  if p_items is not null and pg_catalog.jsonb_typeof(p_items) = 'array' then
    select pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object('block', e ->> 'block', 'content', e ->> 'content')
             order by e ->> 'block'
           )
      into v_items_in
      from pg_catalog.jsonb_array_elements(p_items) as e;
  end if;

  if p_idempotency_key is not null then
    select h.id, h.department, h.shift_type, h.created_by
      into v_handover_id, v_dep_previo, v_turno_previo, v_autor_previo
      from public.shift_handovers h
     where h.org_id = p_org_id and h.idempotency_key = p_idempotency_key;
    if v_handover_id is not null then
      select pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object('block', i.block, 'content', i.content)
               order by i.block
             )
        into v_items_previo
        from public.handover_items i
       where i.handover_id = v_handover_id;
      if v_autor_previo = v_uid
         and v_dep_previo = p_department
         and v_turno_previo = p_shift_type
         and v_items_in is not null
         and v_items_previo = v_items_in then
        return v_handover_id;
      end if;
      raise exception 'idempotency key reused with a different request' using errcode = '22000';
    end if;
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

  -- Cota barata primero: un texto de > 2000 puntos de código ya pasa del límite.
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

  insert into public.shift_handovers (org_id, department, shift_type, created_by, idempotency_key)
  values (p_org_id, p_department, p_shift_type, v_uid, p_idempotency_key)
  on conflict (org_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_handover_id;

  if v_handover_id is null then
    -- Carrera: otra peticion con la misma clave inserto primero.
    select h.id, h.department, h.shift_type, h.created_by
      into v_handover_id, v_dep_previo, v_turno_previo, v_autor_previo
      from public.shift_handovers h
     where h.org_id = p_org_id and h.idempotency_key = p_idempotency_key;
    if v_handover_id is null then
      raise exception 'could not resolve idempotent handover' using errcode = '40001';
    end if;
    select pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object('block', i.block, 'content', i.content)
             order by i.block
           )
      into v_items_previo
      from public.handover_items i
     where i.handover_id = v_handover_id;
    if v_autor_previo = v_uid
       and v_dep_previo = p_department
       and v_turno_previo = p_shift_type
       and v_items_in is not null
       and v_items_previo = v_items_in then
      return v_handover_id;
    end if;
    raise exception 'idempotency key reused with a different request' using errcode = '22000';
  end if;

  insert into public.handover_items (handover_id, org_id, block, content)
  select v_handover_id, p_org_id, e.item ->> 'block', e.item ->> 'content'
    from pg_catalog.jsonb_array_elements(p_items) with ordinality as e(item, pos)
   order by e.pos;

  return v_handover_id;
end;
$$;

revoke execute on function public.create_handover_idempotent(uuid, text, text, jsonb, uuid) from public, anon, service_role;
grant execute on function public.create_handover_idempotent(uuid, text, text, jsonb, uuid) to authenticated;
