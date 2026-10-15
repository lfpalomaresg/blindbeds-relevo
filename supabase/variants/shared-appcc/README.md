# Variante «proyecto compartido con APPCC/Audit»

`000002_relevo_tables.sql` **no es una migración secuencial** de este repo: es
una variante alternativa a `supabase/migrations/000001_baseline.sql` pensada
para desplegar Relevo dentro de un proyecto Supabase que ya tiene
`organizations`, `memberships`, `get_user_org_ids()` y `has_org_role()`
(creados por la migración 000001 de APPCC).

Por eso vive fuera de `supabase/migrations/`:

- `supabase db push` y `scripts/setup-supabase-pro.sh` aplican únicamente lo que
  hay en `supabase/migrations/`. Si este fichero estuviera allí, se aplicaría
  después del baseline y fallaría con `relation "shift_handovers" already exists`
  (SQLSTATE 42P07). El test `tests/db/rls.test.ts` lo comprueba sobre un
  Postgres real.
- Aplicado solo (sin baseline) sobre un proyecto limpio falla también, porque
  `organizations` y las funciones no existen.

## Cuándo usarla

Solo si el operador decide alojar Relevo en el mismo proyecto Supabase que
APPCC/Audit en vez de en un proyecto propio. En ese caso:

1. No aplicar `000001_baseline.sql`.
2. Comprobar que la `has_org_role()` de APPCC aplica la jerarquía estricta
   `staff < supervisor < admin` (la del baseline de Relevo fue corregida en este
   repo; la de APPCC puede arrastrar el mismo fallo).
3. Aplicar este fichero con `psql -f`.
4. Aplicar después `supabase/migrations/000002_change_ticket_status.sql`: la app
   cambia el estado de los partes con esa función (solo depende de
   `maintenance_tickets`, `ticket_updates` y `auth.uid()`, que existen en esta
   variante).

Decisión pendiente del operador: proyecto propio (baseline) o compartido
(variante). Este repo está preparado para el primero.
