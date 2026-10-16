# Notas de sesión

Formato: **Hecho · Pendiente · Decidido**. La entrada más reciente arriba.

---

## 2026-10-15 — Runbook de operación y guion de prueba (encargo f5-relevo-docs)

**Hecho** · Solo documentación, sin tocar código.
[`30_RUNBOOK_OPERACION.md`](30_RUNBOOK_OPERACION.md): altas/bajas/roles por
SQL, relevo, partes con foto, fallo de subida, «no veo el parte», copias y
restauración, cada comportamiento con `fichero:línea`.
[`31_GUION_PRUEBA_USUARIOS.md`](31_GUION_PRUEBA_USUARIOS.md): sesión de ~35 min
con jefe de recepción y técnico, datos ficticios del seed demo. README los
lista en el árbol de `docs/` (sin enlace). No duplica [`20_ACTIVACION_SUPABASE.md`](20_ACTIVACION_SUPABASE.md).
**Pendiente** · Hallazgos al leer el código (no arreglados, fuera de alcance):
`supervisor` no tiene permisos extra sobre `staff`; la foto se guarda pero no
se muestra en ninguna pantalla; no hay copias ni restauración definidas;
`public/sw.js` responde desde caché a todos los GET (posible lista desfasada,
no verificado en navegador); el login no muestra `?error=`; el enlace mágico
vuelve a `/` y no a `/auth/callback` (verificar el día de la activación);
`org.ts` elige una membership al azar si hay varias; `TicketList` y
`PendingItems` ignoran errores de escritura.
**Decidido** · Lo no implementado se marca «no existe todavía» en el runbook;
las decisiones (foto obligatoria, caché del SW, copias de Storage) quedan para
el operador.
**Careo Codex (NO APTO) → corregido** · El alta de usuarios pasa a estar
marcada como pendiente de validar (depende del login por enlace mágico) y se
separa el operador del proyecto (SQL Editor, sin RLS) del `admin` de la app
(sujeto a RLS, sin UI). La sección de copias dice que hoy no se puede restaurar
y deja de dar un comando `pg_dump`. El guion usa un proyecto de prueba
desechable en vez de borrar datos sueltos. Rechazado en parte: `pg_dump
--schema=public` sí exporta datos (el que solo exporta el esquema es
`--schema-only`); el comando se retira de todos modos porque sin `auth.users`
la copia no se puede restaurar. Los dos hallazgos menores (README sin enlaces
navegables, referencia al commit) se dejan sin tocar.
**Careo Codex 2 (NO APTO) → corregido** · `public/sw.js` busca en la caché por
URL sin mirar quién hizo la petición y no la vacía al cerrar sesión: en un
dispositivo compartido puede mostrar datos de la sesión anterior (deducido,
no verificado). El runbook (§5 y bajas) y el guion lo advierten: nada de
dispositivos o perfiles compartidos y borrar los datos del sitio al cambiar de
usuario hasta que se corrija el service worker. Menores sin tocar.

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

## 2026-10-14 — Parches de dependencias y CI Linux (HP)

### Hecho
- Rama fix/dependency-security-20261014: Next y eslint-config-next 16.3.8, sharp 0.35.5, DOMPurify 3.4.17 y source-map-js 1.2.2. Sin cambios de lógica de aplicación, auth ni RLS.
- Rojo: npm audit previo exit 1 (9 paquetes: 1 crítico, 7 altos, 1 bajo); GitHub lista 11 avisos sobre cuatro paquetes runtime. Verde: npm audit --omit=dev exit 0, sin vulnerabilidades de ejecución.
- npm ci, typecheck y lint pasan. Build pasa con URL/anon key ficticias de Supabase, sin proyecto real.
- Windows: 185 tests pasan; 11 fallan por montaje POSIX (sh ausente y binarios shell falsos); 80 RLS omitidos por falta de PostgreSQL. No se presentan como suite verde.
- Añadido CI Linux, idéntico al workflow del PR #2: Ubuntu, Node 22, PostgreSQL efímero obligatorio, lint, typecheck, suite completa y build sin secretos. No incorpora los cambios de esquema del PR #2.
- Revisión independiente Codex nivel 1: APTO estático para rama/PR, condicionado a CI verde; manifest/lock alineados, integridades de npm y rangos compatibles.

### Pendiente
- Ejecutar CI del PR antes de fusionar; los avisos de GitHub no se cierran hasta que el arreglo llegue a main.
- npm audit completo conserva cinco avisos altos de desarrollo en la cadena eslint-config-next → fast-glob → micromatch → braces. El origen es braces <=3.0.3, última versión publicada 3.0.3; no hay parche compatible disponible a fecha de revisión. No usar npm audit fix --force (propone bajar eslint-config-next a 14).
- El PR #2 de activación sigue independiente. No se ha desplegado ni creado base de datos.

### Decidido
- Aplicar versiones de parche mínimas para las 11 alertas runtime, sin saltar a Next 16.4 ni actualizar dependencias ajenas.
- La auditoría es el reproductor rojo/verde de dependencias; la regresión funcional se verifica en Linux y PostgreSQL real.
