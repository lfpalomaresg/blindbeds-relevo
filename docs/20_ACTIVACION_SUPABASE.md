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
cluster en un directorio temporal, aplica `supabase/migrations/000001_baseline.sql`
sobre un stub de `auth`/`storage` y comprueba las policies para
`staff / supervisor / admin`, anon, usuarios sin membership y organizaciones
suspendidas en las 7 tablas. Si está verde, la migración es aplicable y las
policies hacen lo que dicen.

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

El script: comprueba `psql`, lee `.env.local`, aplica `000001_baseline.sql`,
carga `scripts/seed-demo.sql`, verifica las 7 tablas, que RLS esté activo en
todas y que exista el bucket privado `ticket-photos`, e imprime las variables
públicas para Vercel. Sale con 1 en el primer fallo. Está cubierto por
`tests/scripts/setup-supabase-pro.test.ts` con un `psql` falso.

**No aplicar** `supabase/variants/shared-appcc/000002_relevo_tables.sql`. Es la
variante para alojar Relevo dentro del proyecto de APPCC; duplica el baseline y
falla con `42P07` si se aplica detrás. Ver el README de esa carpeta.

## 4. Primer usuario y organización (10 min)

La app no tiene alta de organizaciones ni invitaciones (RLS impide crear
`organizations` desde el cliente). Con el *SQL Editor* del dashboard o `psql`:

```sql
-- 1) El usuario entra una vez con magic link para que exista en auth.users.
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
- Escanear un QR de `scripts/seed-demo.sql` (`ASSET-101`…) → el parte lleva el
  `asset_id` del activo.
- Con un usuario `staff`, intentar insertar en `ticket_assets` desde el SQL
  Editor con `set role authenticated` → debe fallar con `42501`.

## Harness local: cómo funciona

- `tests/harness/pg.ts`: localiza `initdb`/`pg_ctl` (`PG_BIN_DIR`, PATH o
  `/usr/lib/postgresql/*/bin`), crea el cluster en `/tmp/relevo-pg-*` (ruta
  corta por el límite del socket Unix), lo arranca solo por socket y lo
  destruye al acabar. Si corre como root usa `setpriv` para ejecutar Postgres
  como `postgres`/`nobody`.
- `tests/harness/supabase-stub.sql`: roles `anon/authenticated/service_role`,
  `auth.users`, `auth.uid()` leyendo `request.jwt.claims`, `storage.buckets`
  y los privilegios por defecto que Supabase da sobre `public`.
- `tests/harness/rls.ts`: `runAs(client, actor, fn)` ejecuta en una transacción
  con `set local role` + claims y siempre hace `rollback`.
- `tests/harness/fixture.sql`: datos sintéticos (hoteles Alfa/Beta/Gamma).

Añadir una migración nueva = añadir `supabase/migrations/00000N_*.sql` y
aplicarla en el `beforeAll` de `tests/db/rls.test.ts` detrás del baseline.

## Pendiente conocido antes de dar por activo (careo 2026-10-11)

Heredado de `main`, fuera del alcance del PR #1; sin test que lo cubra todavía.
Decidir y aplicar ANTES de dar Relevo por operativo:

1. **Fotos: no hay policies sobre `storage.objects`.** El baseline solo crea la
   fila del bucket `ticket-photos`. Sin una policy `insert`/`select` para
   `authenticated` limitada a `bucket_id = 'ticket-photos'` y a la carpeta
   `<org_id>/` del usuario, `TicketForm` fallará al subir la foto en un Supabase
   real. El harness no modela `storage.objects`, así que el verde no lo prueba.
2. **Cruce entre organizaciones por FK simple.** `handover_items.handover_id` y
   `maintenance_tickets.asset_id` solo exigen que la fila referenciada exista,
   no que sea de la misma `org_id`. Un miembro de A podría enlazar un item a un
   relevo de B o un parte a un activo de B (necesita adivinar el UUID; no hay
   lectura cruzada). Remedio: FK compuesta `(handover_id, org_id)` /
   `(asset_id, org_id)` con `unique (id, org_id)` en la tabla padre.
3. **Escrituras no atómicas en el cliente.** `HandoverForm` inserta el relevo y
   después los items; `TicketForm` sube la foto y después el parte. Si falla el
   segundo paso queda un relevo vacío o una foto huérfana. Remedio: RPC
   transaccional en Postgres o borrado compensatorio.
