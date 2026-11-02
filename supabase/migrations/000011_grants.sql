-- Privilegios de tablas y ACL de funciones, explícitos en el repo.
--
-- Por qué: el proyecto cloud `relevo` (01/11/2026) se creó con «exponer tablas
-- nuevas» DESACTIVADO, así que Supabase no concede privilegios por defecto
-- sobre `public`. Las migraciones 000001–000010 no traían GRANT de tablas y la
-- app recibía 42501. Se arregló a mano en producción con
--   grant all on all {tables,sequences,functions} in schema public to anon, authenticated, service_role
-- que, además, DESHIZO los REVOKE de las funciones (anon podía ejecutar
-- handover_author_emails y purge_expired_handovers).
--
-- Esta migración:
--   1. Concede sobre tablas y secuencias lo mismo que un proyecto Supabase
--      estándar. RLS sigue activo en todas las tablas: el GRANT abre la puerta,
--      las policies deciden qué filas.
--   2. Reafirma la ACL de diseño de cada función (la misma de 000005–000010) y
--      quita a anon el EXECUTE de las funciones futuras.
-- Es idempotente: se puede reaplicar sobre producción para corregir la deriva.

-- 1. Esquema, tablas y secuencias -------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

-- Funciones futuras: nunca EXECUTE implícito para anon (cada migración concede
-- lo suyo de forma explícita).
alter default privileges in schema public revoke execute on functions from public, anon;

-- 2. ACL de diseño de las funciones -----------------------------------------
-- Primero, NADIE fuera de los roles explícitos: se revoca EXECUTE a PUBLIC y
-- anon en TODAS las funciones de public (incluidas las de trigger, que no
-- necesitan EXECUTE para dispararse). Después, cada función recibe lo suyo.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute pg_catalog.format('revoke execute on function %s from public, anon', f);
  end loop;
end
$$;

-- Funciones de trigger: nadie las llama por RPC.
revoke execute on function public.ticket_updates_set_org_id() from authenticated;

-- RLS helpers (000001): las policies sin `to` se evalúan también para anon,
-- así que anon conserva EXECUTE (sin sesión devuelven vacío / false).
grant execute on function public.get_user_org_ids() to anon, authenticated, service_role;
grant execute on function public.has_org_role(uuid, text) to anon, authenticated, service_role;

-- 000005
revoke execute on function public.change_ticket_status(uuid, text, text) from public, anon;
grant execute on function public.change_ticket_status(uuid, text, text) to authenticated, service_role;

-- 000006
revoke execute on function public.create_handover(uuid, text, text, jsonb) from public, anon, service_role;
grant execute on function public.create_handover(uuid, text, text, jsonb) to authenticated;

-- 000007 (security definer: lee auth.users)
revoke execute on function public.handover_author_emails(uuid, uuid[]) from public, anon, service_role;
grant execute on function public.handover_author_emails(uuid, uuid[]) to authenticated;

-- 000010 (security definer: lee auth.users)
revoke execute on function public.ticket_author_emails(uuid, uuid[]) from public, anon, service_role;
grant execute on function public.ticket_author_emails(uuid, uuid[]) to authenticated;

-- 000008 (borra relevos de TODAS las organizaciones)
revoke execute on function public.purge_expired_handovers() from public, anon, authenticated;
grant execute on function public.purge_expired_handovers() to service_role;
