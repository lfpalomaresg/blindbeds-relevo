# Notas de sesión

Formato: **Hecho · Pendiente · Decidido**. La entrada más reciente arriba.

---

## 2026-10-12 — Bloqueos de activación: CI, policies de storage, FK por org (Mac)

Rama `work/activation-blockers` → PR contra `main` (sin fusionar). Nada se ha
aplicado a ningún Supabase: no existe proyecto.

**Hecho** · Suite 276 → 448 (22 ficheros; `tests/db` 80 → 223 sobre PostgreSQL
17 real), lint 0/0, typecheck 0, `next build` OK con env ficticias. Cada punto
con test visto en rojo antes.
1. **CI** (`.github/workflows/ci.yml`, push y PR a `main`): `npm ci` con caché,
   lint `--max-warnings=0`, typecheck, suite completa con el PostgreSQL del
   runner y `next build`. `gatePg()` hace que `tests/db` FALLE en vez de
   omitirse con `CI=true` o `RLS_REQUIRE_PG=1` (probado lanzando vitest como
   subproceso sin binarios de Postgres: antes salía 0 con 80 omitidos).
2. **`000003_storage_policies.sql`**: leer = miembro activo de la org del
   prefijo; subir = igual, solo a `<org_id>/<fichero>`; borrar = admin; sin
   update; nada para anon ni org suspendida. Matriz rol × operación × org en
   `tests/db/storage.test.ts` contra un stub de `storage` solo para tests.
3. **`000004_org_scoped_fks.sql`**: `unique (id, org_id)` + FK compuestas en
   `handover_items`, `maintenance_tickets` y `ticket_updates` (esta gana
   `org_id`, heredado del parte por trigger). El cruce da `23503` también para
   `service_role`. Aborta con mensaje si ya hay filas cruzadas.
- `setup-supabase-pro.sh`: aplica todas las migraciones con `ON_ERROR_STOP` y
  una transacción por fichero (antes `psql -f` devolvía 0 aunque el SQL
  fallara), salta el baseline si ya está, verifica policies de tablas y storage.
- Careo nivel 1 con Codex, 2 rondas: R1 RECHAZADO (setup no re-ejecutable;
  guardas por nombre en 000004 engañables por deriva) → corregidos con rojo
  previo. R2 APROBADO CON CAMBIOS (baseline a medias no detectado → corregido;
  fotos huérfanas/cuota → documentado, es el pendiente de atomicidad).

**Pendiente** · Verificar las policies de storage en el Supabase real (runbook
§6 «Fotos»): el stub no es la API de Storage. Escrituras no atómicas y fotos
huérfanas. Referencias a usuarios de otra org (`assigned_to`, etc.).

**Decidido** · Prefijo de org comparado como texto (un nombre malicioso se
deniega, no rompe con error de cast). Sin policy de `update`: las fotos son
inmutables. No se condiciona la subida a `owner = auth.uid()` (no verificable
sin Supabase real). 000004 no reescribe filas cruzadas: se niega a correr.
Queda al operador: foto obligatoria sí/no; si `staff` debe poder borrar su foto.

---

## 2026-10-11 — Revisión del PR #1 (Mac, careo nivel 1 con Codex)

**Hecho** · Suite 272 → 276 (RLS 78 → 80, harness +2) sobre PostgreSQL 17.11
real; lint y typecheck en 0; ley del rojo verificada en 5 tests. Fixes: `/icon-`
pasa a patrón cerrado `/icon-<n>.png` (antes cualquier `/icon-*` era público);
el harness intenta `pg_ctl stop` si `pg_ctl start` falla a medias. Tests nuevos:
staff/supervisor no borran activos y admin sí; un parte no se mueve de org.
**Pendiente** · Runbook §«Pendiente conocido»: policies de `storage.objects`,
FK compuestas anti-cruce de orgs, escrituras no atómicas (heredado de `main`).
`next build` sin env de Supabase falla en `/dashboard` también en `main`.
**Decidido** · Los hallazgos heredados no se arreglan en este PR: van al runbook
con remedio propuesto para que el operador decida antes de activar Supabase.

---

## 2026-10-11 — Harness Postgres + RLS, hardening, cobertura

Rama: `claude/rls-postgres-harness-m1ly4y` → PR contra `main`.
Suite antes: 98 tests / 7 ficheros, lint 0, typecheck 0.
Suite después: 272 tests / 17 ficheros, lint 0, typecheck 0, `next build` OK.

### Hecho

- **Harness Postgres efímero sin Docker** (`tests/harness/pg.ts`): `initdb` +
  `pg_ctl` en `/tmp`, stub de `auth`/`storage`/roles de Supabase, fixture
  sintético. 78 tests en `tests/db/rls.test.ts` cubren las 7 tablas para
  staff / supervisor / admin, anon, sin membership y org suspendida.
  `npm run test:rls` exige Postgres; `npm test` lo omite con aviso si no hay.
- **Dos fallos reales en `000001_baseline.sql` vistos en rojo y corregidos**:
  1. El índice `handover_items_pending_idx` usaba `org_id` antes de que la
     columna existiera (`alter table` posterior) → la migración abortaba con
     SQLSTATE 42703. Ahora `org_id` va dentro del `create table`.
  2. `has_org_role()` devolvía `true` para supervisor con `min_role='admin'`
     (un supervisor podía gestionar activos y memberships). Ahora jerarquía
     numérica estricta; `min_role` desconocido nunca se cumple.
- **`000002_relevo_tables.sql`** movida a `supabase/variants/shared-appcc/` con
  README: es la variante «proyecto compartido con APPCC», no una migración
  secuencial; aplicada tras el baseline falla con 42P07 (test real lo prueba).
- **Hardening**:
  - `src/middleware.ts` → `src/proxy.ts` (Next 16 deprecó `middleware`).
    Rutas públicas por coincidencia exacta (+ `/sw.js`, que antes exigía
    sesión). Sin env de Supabase → `/login?error=config`; error de `getUser`
    → sin sesión.
  - `/auth/callback`: el parámetro `next` ya no permite open redirect
    (`https://`, `//host`, `/\host`, codificados). `/auth/confirm` valida `type`
    contra el catálogo de `EmailOtpType`.
  - `src/lib/validation.ts`: catálogos, recorte, límites (bloque 2000, título
    120, descripción 2000), relevo con ≥1 bloque, `asset_id` debe ser UUID,
    foto ≤ 10 MB y JPEG/PNG/WebP con extensión derivada del MIME, ruta de
    storage `<org>/<uuid>.<ext>` sin posibilidad de traversal.
  - `TicketForm`: el QR se resuelve contra `ticket_assets.qr_code` y se envía
    el `id`; antes se insertaba el texto del QR en una columna `uuid`.
  - Etiquetas asociadas a sus controles (`htmlFor`/`id`), errores con
    `role="alert"`.
- **`scripts/setup-supabase-pro.sh`**: comprueba `psql` antes de nada; test de
  shell sin red con `psql` falso (orden de operaciones, fallos cerrados, no
  imprime secretos). Añadido `.env.local.example` (des-ignorado en
  `.gitignore`).
- **Cobertura**: tests de componentes (HandoverForm, TicketForm, PendingItems,
  TicketList) con jsdom + Testing Library sobre un Supabase falso en memoria;
  tests de API de `/auth/callback`, `/auth/confirm` y `proxy`.
- Docs: `docs/20_ACTIVACION_SUPABASE.md` (runbook de una hora).
- Limpieza: `vitest.config.mts` duplicado y muerto eliminado.

### Pendiente (operador)

- Crear el proyecto Supabase Pro y ejecutar el runbook. Nada se ha aplicado a
  ningún Supabase.
- Alta del primer admin y de organizaciones: no hay UI; se hace por SQL (ver
  runbook §4).
- Si APPCC comparte `has_org_role()`, revisar allí el mismo fallo de jerarquía.
- `.vercel/project.json`: no existía en el repo (nunca fue trackeado) y
  `.vercel` ya estaba en `.gitignore`. Sin acción.
- Los 3 errores `no-use-before-define` ya estaban corregidos en `main`
  (commit `1f14ec6`); lint estaba y sigue a 0.

### Decidido (y por qué)

- Harness en `/tmp` y no en el scratchpad: el socket Unix de Postgres no admite
  rutas de más de ~107 bytes y el directorio debe ser accesible por el usuario
  sin privilegios que ejecuta `initdb`.
- `npm test` omite la matriz RLS si no hay Postgres (con aviso) para no romper
  entornos sin binarios; `npm run test:rls` la exige. CI debería usar este
  último.
- La foto sigue siendo opcional en código aunque README/UI digan «obligatoria»:
  es decisión de producto; se deja al operador (ver PR).
- No se añadió `check` a `ticket_updates.status_to` ni policies de `update` a
  `shift_handovers` (leer/marcar como leído): cambios de esquema fuera del
  encargo; documentados en el PR.
