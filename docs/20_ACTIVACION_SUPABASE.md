# Activar Supabase Pro en una hora

Guía para el operador el día que exista el proyecto Supabase. Todo lo que hay
debajo se ha ensayado contra un Postgres real efímero (ver «Harness local»),
nunca contra un Supabase. Nada de este repo despliega ni aplica migraciones por
sí solo.

## 0. Antes de tener el proyecto (5 min, en tu máquina)

```bash
npm install
npm test            # suite completa, incluye la matriz RLS sobre Postgres efímero
npm run test:rls    # solo la matriz RLS; falla si no hay binarios de Postgres
```

`npm run test:rls` necesita `initdb`/`pg_ctl` instalados (paquete `postgresql`
en Debian/Ubuntu, `postgresql@17` o cualquier `postgresql@<v>` en Homebrew: el
harness autodetecta `/opt/homebrew/opt/postgresql@<v>/bin` aunque no esté en el
`PATH`). No usa Docker ni red: arranca un
cluster en un directorio temporal, aplica TODAS las migraciones de
`supabase/migrations/` en orden sobre un stub de `auth`/`storage` y comprueba:

- `tests/db/rls.test.ts`: las policies para `staff / supervisor / admin`, anon,
  usuarios sin membership y organizaciones suspendidas en las 7 tablas;
- `tests/db/storage.test.ts`: las policies de `storage.objects` del bucket
  `ticket-photos` (rol × leer/subir/borrar/mover × org propia/ajena/suspendida);
- `tests/db/org-fks.test.ts`: las FK compuestas que impiden enlazar filas de
  organizaciones distintas.

Si está verde, las migraciones son aplicables y las policies hacen lo que
dicen **sobre Postgres**. Lo que el harness NO puede probar es la API de
Storage de Supabase: ver §6 «Fotos».

El mismo `npm test` corre en GitHub Actions (`.github/workflows/ci.yml`) en cada
push y PR a `main`, con el PostgreSQL del runner. En CI (`CI=true`) la ausencia
de Postgres es un fallo: los tests de `tests/db` no se omiten nunca en verde.

## 1. Crear el proyecto (10 min, Dashboard de Supabase)

1. Organización nueva → proyecto `blindbeds-relevo` (plan Pro, región UE).
2. Project Settings → API: copiar `URL`, `anon key`, `service_role key`.
3. Project Settings → Database: copiar la contraseña de la base de datos.
4. Authentication → URL Configuration: `Site URL` = dominio de Vercel;
   añadir `https://<dominio>/auth/callback` y `https://<dominio>/auth/confirm`
   a *Redirect URLs*. Authentication → Providers → Email: activar *magic link*.

## 2. Configurar el repo (5 min)

```bash
cp .env.local.example .env.local   # rellenar las 4 variables
```

`.env.local` está ignorado por git. `SUPABASE_SERVICE_ROLE_KEY` y
`SUPABASE_DB_PASSWORD` no salen nunca de tu máquina.

## 3. Aplicar esquema y seed (5 min)

```bash
./scripts/setup-supabase-pro.sh
```

El script: comprueba `psql`, lee `.env.local`, aplica en orden todas las
migraciones de `supabase/migrations/` (cada una en su transacción y con
`ON_ERROR_STOP`: si una falla, corta y no deja nada a medias de ese fichero),
carga `scripts/seed-demo.sql`, verifica las 7 tablas, que RLS esté activo en
todas, que exista el bucket privado `ticket-photos` y sus 3 policies de
storage, e imprime las variables públicas para Vercel. Sale con 1 en el primer
fallo. Está cubierto por `tests/scripts/setup-supabase-pro.test.ts` con un
`psql` falso.

Se puede volver a ejecutar: si `public.organizations` ya existe, salta
`000001_baseline.sql` (no es repetible) y aplica las demás. Además comprueba que
las 7 tablas tienen sus 16 policies; si no cuadra (baseline aplicado a medias)
sale con 1 en vez de decir «Setup completo».

| Migración | Qué hace |
|---|---|
| `000001_baseline.sql` | Tablas, funciones, RLS y el bucket `ticket-photos`. |
| `000003_storage_policies.sql` | Policies de `storage.objects` para `ticket-photos`. |
| `000004_org_scoped_fks.sql` | `unique (id, org_id)` + FK compuestas anti-cruce de organizaciones; añade `ticket_updates.org_id`. |
| `000005_change_ticket_status.sql` | Función `change_ticket_status`: estado + traza en `ticket_updates` en una sola transacción (`security invoker`). |
| `000006_create_handover.sql` | Función `create_handover`: cabecera del relevo + items en una sola transacción (`security invoker`). |

No existe `000002` en esta carpeta a propósito (es la variante de abajo).
`000003`, `000004`, `000005` y `000006` son idempotentes: se pueden volver a aplicar.

**No aplicar** `supabase/variants/shared-appcc/000002_relevo_tables.sql`. Es la
variante para alojar Relevo dentro del proyecto de APPCC; duplica el baseline y
falla con `42P07` si se aplica detrás. Ver el README de esa carpeta.

**Proyectos ya creados con solo el baseline:** antes de desplegar la versión de
la app que usa `change_ticket_status`, aplicar
`supabase/migrations/000005_change_ticket_status.sql` (`psql "$DB_URL" -f …` o
`supabase db push`). Sin esa función, «En curso» y «Cerrar» fallan con error.

## 4. Primer usuario y organización (10 min)

La app no tiene alta de organizaciones ni invitaciones (RLS impide crear
`organizations` desde el cliente). Con el *SQL Editor* del dashboard o `psql`:

**Antes, cerrar el alta:** *Authentication → Sign In / Providers →* desactivar *Allow new users
to sign up*. La app ya pide el enlace con `shouldCreateUser: false`, pero sin este interruptor
cualquiera podría crear cuentas llamando a la API directamente (informe e2e del 27/10). Con el
alta cerrada, un correo que no existe ve lo mismo que uno que sí, y no recibe nada.

```sql
-- 1) Crear el usuario: Authentication → Users → «Add user» → «Send invitation»
--    (o «Create new user» con «Auto Confirm User»). El enlace mágico ya no crea cuentas.
-- 2) Vincularlo a la organización demo como admin:
insert into public.memberships (org_id, user_id, role)
select '00000000-0000-0000-0000-000000000001', id, 'admin'
from auth.users where email = '<email-del-admin>';
```

A partir de ahí el admin puede añadir miembros (`memberships_admin_write`)
y activos (`assets_admin_manage`) desde SQL; la UI de gestión no existe aún.

## 5. Vercel (10 min)

Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Nunca
`SUPABASE_SERVICE_ROLE_KEY`. El proxy de autenticación (`src/proxy.ts`)
redirige a `/login?error=config` si faltan.

## 6. Comprobación final (10 min)

- Entrar con magic link → `/dashboard` muestra la organización.
- Crear un relevo con un bloque → aparece en «Pendientes sin resolver».
- Crear un parte con foto JPEG < 10 MB → sube a `ticket-photos/<org>/<uuid>.jpg`.
  **Esta es la verificación definitiva de las policies de storage** (ver «Fotos»
  más abajo): hasta que no se vea subir una foto en el proyecto real, no darlas
  por buenas.
- Escanear un QR de `scripts/seed-demo.sql` (`ASSET-101`…) → el parte lleva el
  `asset_id` del activo.
- Con un usuario `staff`, intentar insertar en `ticket_assets` desde el SQL
  Editor con `set role authenticated` → debe fallar con `42501`.

### Fotos: lo que hay que comprobar en el Supabase real

Las policies de `000003_storage_policies.sql` están probadas contra un **stub**
del esquema `storage` (`tests/harness/storage-stub.sql`), no contra Supabase.
El stub reproduce `storage.buckets`, `storage.objects` (con RLS activo y los
mismos permisos) y `storage.foldername()`, pero no la API de Storage ni el rol
propietario real de esas tablas. Antes de dar las fotos por operativas, en el
proyecto real:

| Quién | Qué | Resultado esperado |
|---|---|---|
| `staff` de la org | Crear un parte con foto desde la app | Sube; el parte guarda `photo_path = <org>/<uuid>.<ext>` |
| `staff` de la org | Storage → `ticket-photos`: ver la foto de su org | Visible (signed URL) |
| Usuario de OTRA org | Pedir esa misma ruta con el cliente de Supabase | No existe / denegado |
| `staff` | Borrar la foto con el cliente (`storage.from(...).remove`) | No se borra |
| `admin` de la org | Borrar la foto | Se borra |
| Sin sesión (anon key sola) | Listar o descargar | Nada |

Si la migración fallara al crear las policies (`must be owner of table objects`
u otro error de permisos sobre `storage.objects`), créalas con el mismo SQL
desde el *SQL Editor* del dashboard o desde Storage → Policies: el contenido
de las policies es el que está probado; lo que cambia es quién puede crearlas.

Reglas que aplican las policies (decisiones de diseño, revisables):

- Ruta obligatoria `<org_id>/<fichero>`: un solo nivel, `org_id` en minúsculas
  (como lo genera `buildPhotoPath`). Ni objetos en la raíz ni subcarpetas.
- Leer: cualquier miembro de una org **activa**. Subir: lo mismo (quien puede
  abrir un parte). Borrar: solo `admin` de esa org. Modificar/mover/`upsert`:
  nadie (no hay policy de `update`).
- Org suspendida o archivada: sin acceso a sus fotos (ni lectura).
- `anon`: nada. `service_role` (servidor) no está limitado por RLS.
- El límite de 10 MB y los MIME permitidos son del **bucket** y los aplica la
  API de Storage, no SQL.

## Harness local: cómo funciona

- `tests/harness/pg.ts`: localiza `initdb`/`pg_ctl` (`PG_BIN_DIR`, PATH o
  `/usr/lib/postgresql/*/bin`), crea el cluster en `/tmp/relevo-pg-*` (ruta
  corta por el límite del socket Unix), lo arranca solo por socket y lo
  destruye al acabar. Si corre como root usa `setpriv` para ejecutar Postgres
  como `postgres`/`nobody`.
- `tests/harness/supabase-stub.sql`: roles `anon/authenticated/service_role`,
  `auth.users`, `auth.uid()` leyendo `request.jwt.claims`, `storage.buckets`
  y los privilegios por defecto que Supabase da sobre `public`.
- `tests/harness/storage-stub.sql`: `storage.objects` (RLS activo, mismos
  permisos que Supabase) y `storage.foldername()`. **Solo para tests**: no es
  una migración y nunca se aplica a un proyecto.
- `tests/harness/db.ts`: `bootstrap()` aplica stubs + todas las migraciones +
  fixture; lo usan los tres ficheros de `tests/db`.
- `gatePg()` en `pg.ts`: sin Postgres, en local avisa y omite; con `CI=true` o
  `RLS_REQUIRE_PG=1` lanza y el fichero falla.
- `tests/harness/rls.ts`: `runAs(client, actor, fn)` ejecuta en una transacción
  con `set local role` + claims y siempre hace `rollback`.
- `tests/harness/fixture.sql`: datos sintéticos (hoteles Alfa/Beta/Gamma).

Añadir una migración nueva = añadir `supabase/migrations/00000N_*.sql`. Los
tests de `tests/db` y el script de setup aplican todas las de la carpeta en
orden; hay que actualizar la lista esperada en `tests/lib/migration.test.ts`.

## Pendiente conocido antes de dar por activo

Resuelto el 2026-10-12 (PR `work/activation-blockers`), con test rojo previo:

- ~~Fotos: no hay policies sobre `storage.objects`~~ → `000003_storage_policies.sql`
  + `tests/db/storage.test.ts`. Queda la verificación en el Supabase real (§6).
- ~~Cruce entre organizaciones por FK simple~~ → `000004_org_scoped_fks.sql`
  + `tests/db/org-fks.test.ts`. El cruce se rechaza con `23503` para cualquier
  rol, incluido `service_role`.
- ~~Sin CI~~ → `.github/workflows/ci.yml`.
- ~~El service worker cacheaba páginas autenticadas~~ → `public/sw.js` +
  `tests/public/sw.test.ts`. Antes precargaba y guardaba `/dashboard`,
  `/handover/new`, etc.: en el dispositivo compartido de recepción otro usuario
  podía ver la sesión anterior. Ahora solo guarda estáticos públicos
  (`/_next/static/*`, `/manifest.json`, `/icon-*.png`); navegaciones, `/api`,
  `/auth`, peticiones RSC, no-GET y otros orígenes (Supabase) van siempre a la
  red. La caché pasa a `relevo-static-v2` y `activate` borra `relevo-v1` en los
  dispositivos ya instalados. Consecuencia: la app ya no abre sin conexión.
  No hay flujo de cierre de sesión en la app, así que no hay limpieza de caché
  al salir (tampoco hace falta: la caché ya no contiene datos de sesión).

Sigue pendiente; decidir y aplicar ANTES de dar Relevo por operativo:

1. **Escrituras no atómicas en el cliente.** `HandoverForm` inserta el relevo y
   después los items; `TicketForm` sube la foto y después el parte. Si falla el
   segundo paso queda un relevo vacío o una foto huérfana. Remedio: RPC
   transaccional en Postgres o borrado compensatorio. Agravante nuevo: un
   `staff` no puede borrar su propia foto huérfana (borrar es solo de `admin`),
   así que el borrado compensatorio tendría que ir por servidor o por RPC.
   Relacionado (careo 2026-10-12): la policy de subida no exige que exista un
   parte, así que un miembro puede acumular fotos sin parte y gastar cuota de
   Storage hasta que un admin las borre. Remedio de fondo: crear antes el parte
   y subir a `<org>/<ticket_id>/<fichero>` con una policy que exija ese parte,
   o subir por servidor; más una limpieza periódica de huérfanos.
2. **Foto obligatoria sí/no.** README y UI dicen «obligatoria»; el código la
   trata como opcional. Decisión de producto sin tomar.
3. **Referencias a usuarios de otra organización.** `created_by`, `read_by`,
   `resolved_by`, `assigned_to` y `closed_by` apuntan a `auth.users` sin exigir
   que ese usuario sea miembro de la org. `created_by` lo fija RLS al propio
   usuario; los demás no se validan. Riesgo bajo (solo un UUID), sin remedio
   aplicado.
4. **Si ya hubiera datos** cuando se aplique `000004`: la migración se niega a
   correr si encuentra items o partes que ya cruzan organizaciones y lo dice.
   Hay que corregir esas filas a mano (decidir cuál de las dos orgs es la
   buena) y volver a aplicarla. En un proyecto nuevo no ocurre.
