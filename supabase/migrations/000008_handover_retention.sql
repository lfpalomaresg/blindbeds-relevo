-- Retención de relevos: 90 días (minimización, RGPD art. 5.1.c y 5.1.e).
--
-- purge_expired_handovers() borra los relevos (shift_handovers) creados hace
-- más de 90 días en TODAS las organizaciones; sus ítems (handover_items) caen
-- por la FK on delete cascade (000004), resueltos o no. Devuelve cuántos
-- relevos ha borrado.
--
-- Quién la ejecuta: el operador, pg_cron (superusuario) o service_role. Un
-- usuario de la app NO (ni siquiera admin): se revoca a anon y authenticated.
-- Es security invoker: no eleva privilegios de nadie. search_path vacío y
-- todo cualificado por esquema.
--
-- Esta migración NO programa nada. La programación diaria con pg_cron está
-- documentada en docs/30_RUNBOOK_OPERACION.md (§ Retención de relevos) y se
-- aplica a mano en cada proyecto Supabase.

create or replace function public.purge_expired_handovers()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.shift_handovers
   where created_at < pg_catalog.now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.purge_expired_handovers() from public, anon, authenticated;
grant execute on function public.purge_expired_handovers() to service_role;
