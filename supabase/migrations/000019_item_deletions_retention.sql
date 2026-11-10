-- Retención del rastro de borrados de ítems del relevo (000018): 2 años.
--
-- handover_item_deletions guarda quién borró qué bloque y cuándo (sin el
-- texto). Es dato personal (deleted_by) y no debe conservarse sin plazo
-- (RGPD art. 5.1.e). Plazo PROVISIONAL de 2 años, propuesto en el round 3
-- de automejora (10/11/2026) y pendiente de confirmar por el operador;
-- cambiarlo es cambiar el intervalo de abajo en una migración nueva.
--
-- purge_expired_item_deletions() borra los asientos con más de 2 años de
-- TODAS las organizaciones y devuelve cuántos ha borrado.
--
-- Quién la ejecuta: el operador, pg_cron (superusuario) o service_role. Un
-- usuario de la app NO (ni siquiera admin): se revoca a anon y authenticated.
-- Es security invoker: no eleva privilegios de nadie. search_path vacío y
-- todo cualificado por esquema.
--
-- Esta migración NO programa nada (igual que 000008). La programación con
-- pg_cron está documentada en docs/30_RUNBOOK_OPERACION.md (§ Retención del
-- rastro de borrados) y se aplica a mano en cada proyecto Supabase.
-- Idempotente.

create or replace function public.purge_expired_item_deletions()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.handover_item_deletions
   where deleted_at < pg_catalog.now() - interval '2 years';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.purge_expired_item_deletions() from public, anon, authenticated;
grant execute on function public.purge_expired_item_deletions() to service_role;
