-- anon deja de tener acceso a `public` — R1 y R2 de la auditoría del 14/11/2026.
--
-- Estado anterior: 000011 reproduce lo que concede un proyecto Supabase
-- estándar, y eso incluye DML sobre TODAS las tablas (más `alter default
-- privileges` para las futuras) a `anon`, y EXECUTE en los dos helpers de RLS.
-- RLS estaba activo en las 8 tablas, así que no había fuga de datos — pero el
-- modelo dependía de que TODA tabla futura recordara activar RLS: la que lo
-- olvidara nacía legible desde internet con la anon key, y nada lo detectaba.
-- Los helpers no filtraban por sí solos (sin sesión devuelven vacío/false),
-- pero son superficie regalada a quien tenga la anon key.
--
-- Esta migración:
--   1. Quita a anon todo privilegio sobre tablas y secuencias de public, y
--      sobre las futuras (default privileges) — cierra R1.
--   2. Le quita el EXECUTE de los helpers de RLS — cierra R2. Ninguna policy
--      los necesita para anon: sin privilegio de tabla, Postgres comprueba el
--      privilegio ANTES de evaluar la policy y anon recibe 42501, que es lo
--      correcto (no «vacío»: un 42501 en el log es un intento, un vacío es
--      un silencio).
--
-- `authenticated` y `service_role` no se tocan. `usage on schema public` se
-- deja a anon a propósito: sin privilegios de tabla no da acceso a datos y
-- PostgREST lo necesita para devolver errores legibles en vez de 500.
-- Idempotente: REVOKE se puede repetir sin efecto.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

revoke execute on function public.get_user_org_ids() from anon;
revoke execute on function public.has_org_role(uuid, text) from anon;
