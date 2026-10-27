# Blindbeds Relevo — Suite de operaciones para hoteles

> Handover de turno (FR-005) + Partes de avería (FR-006).
> Next.js 16 + Supabase + Vercel. PWA mobile-first.

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router) |
| Auth | Supabase Auth (magic link) |
| Base de datos | Supabase Postgres + RLS |
| UI | Tailwind CSS 4 |
| Tests | Vitest (+ jsdom, Testing Library, Postgres efímero para RLS) |
| PWA | Manifest + service worker básicos; faltan los iconos que declara el manifest (ver `docs/32_TEXTOS_VS_REALIDAD.md`) |

## Estructura

```
src/
├── app/
│   ├── login/          # Login con magic link
│   ├── dashboard/      # Panel principal (pendientes + averías)
│   ├── handover/       # Lista de relevos · [id]/ detalle · new/ nuevo relevo
│   ├── tickets/new/    # Nuevo parte de avería
│   └── auth/           # callback + confirm de Supabase Auth
├── proxy.ts            # Auth: fallo cerrado sin sesión (Next 16, antes middleware)
├── components/
│   ├── auth/           # LoginForm
│   ├── handover/       # HandoverForm, PendingItems
│   └── tickets/        # TicketForm, TicketList
├── lib/
│   ├── supabase/       # client, server, admin
│   ├── validation.ts   # Validación de formularios (límites, catálogos, fotos)
│   ├── auth-paths.ts   # Rutas públicas, redirect seguro, env
│   └── org.ts          # Lógica de organización
├── types/              # Tipos compartidos
└── hooks/              # useAuth
supabase/
├── migrations/         # 000001 baseline · 000003 policies de storage · 000004 FK por org · 000005 cambio de estado atómico · 000006 relevo atómico · 000007 emails de autores de relevos · 000008 retención de relevos (90 días)
└── variants/           # 000002: variante «proyecto compartido APPCC», NO aplicar
tests/
├── db/                 # Matriz RLS sobre Postgres efímero (initdb + pg_ctl)
├── harness/            # Arranque de Postgres, stub Supabase, fixture, fake client
├── components/         # jsdom + Testing Library
├── api/                # Route handlers de auth y proxy
└── scripts/            # setup-supabase-pro.sh con psql falso
docs/
├── 10_SESSION_NOTES.md
├── 20_ACTIVACION_SUPABASE.md  # Runbook de activación (1 hora)
├── 30_RUNBOOK_OPERACION.md    # Operación diaria en un hotel y soporte
├── 31_GUION_PRUEBA_USUARIOS.md # Prueba con recepción y mantenimiento
└── 32_TEXTOS_VS_REALIDAD.md   # Inventario: qué promete la UI/README y qué hace el código
```

## Arranque local

```bash
npm install
cp .env.local.example .env.local   # Rellenar con credenciales de Supabase
npm run dev                         # http://localhost:3000
npm test                            # Tests (en local RLS se omite con aviso si no hay Postgres; en CI falla)
npm run test:rls                    # Solo matriz RLS; exige initdb/pg_ctl instalados
```

### Con Supabase local (sin proyecto en la nube)

Con Docker en marcha:

```bash
supabase start                 # aplica supabase/migrations/ + supabase/seed.sql
supabase status -o env         # API_URL y ANON_KEY → .env.local (solo valen en este Mac)
npm run dev                    # http://localhost:3000/login
supabase db reset              # vuelve a empezar: migraciones + seed
supabase stop                  # apaga (conserva los datos)
```

`supabase/seed.sql` crea el **Hotel Demo Mirador** (y un segundo hotel, Costa, para
comprobar que la RLS no mezcla datos) con usuarios `@example.com`:
`direccion` (admin), `gobernanta` (supervisor), `recepcion` y `mantenimiento` (staff),
`costa` (admin de Costa). El enlace mágico no sale a internet: aparece en el buzón local
`http://127.0.0.1:54324`. Panel de Supabase: `http://127.0.0.1:54323`.
Es solo para local: `setup-supabase-pro.sh` carga `scripts/seed-demo.sql`, no este fichero.

## Migraciones

```bash
./scripts/setup-supabase-pro.sh   # Aplica todas las migraciones + seed y verifica (ver docs/20_ACTIVACION_SUPABASE.md)
npx supabase db push              # Alternativa: aplica supabase/migrations/ con la CLI
```

Antes de tocar un Supabase real, `npm run test:rls` aplica la migración sobre un
Postgres efímero local y comprueba las policies para staff / supervisor / admin.

## Despliegue

1. Crear proyecto en Vercel conectado a este repo
2. Configurar env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Nunca `SUPABASE_SERVICE_ROLE_KEY`: la app no la usa; solo la pide `scripts/setup-supabase-pro.sh` desde `.env.local` (ver `docs/20_ACTIVACION_SUPABASE.md`)
3. Deploy

## Módulos

### Handover (FR-005)
Formulario estructurado de 4 bloques (pendientes, VIPs, incidencias, avisos) que cada empleado rellena al terminar su turno. El relevo y sus items se guardan con la función `create_handover` en una sola transacción (migración 000006): si algo falla no queda un relevo a medias. Los items no resueltos persisten hasta que alguien los cierra. Lista de relevos (`/handover`) con departamento, turno, autor y hora, filtro por departamento, y detalle de cada relevo. Cada campo de texto libre avisa: «Sin nombres de huéspedes ni datos de salud: usa el nº de habitación.» Los relevos se borran a los 90 días con `purge_expired_handovers` (migración 000008; la programación con pg_cron está en el runbook y no se aplica sola).

### Averías (FR-006)
Parte de avería con foto opcional, prioridad y estado (abierto → en curso → cerrado). Cada cambio de estado se hace con la función `change_ticket_status`, que actualiza el parte y registra la traza en `ticket_updates` (estado de origen y destino, quién) en una sola transacción (migración 000005): o se guardan ambos o ninguno. Aún no hay vista de historial ni por activo. Foto visible en el parte con URL firmada de corta duración. Por defecto se ven los partes abiertos y en curso. QR escaneable por habitación/equipo, o código del activo escrito a mano si no hay cámara; los activos y sus códigos QR se dan de alta por SQL (no hay UI de gestión).

## Seguridad

- RLS en las 7 tablas públicas con políticas por organización
- Auth vía Supabase con magic link (sin contraseñas): el enlace vuelve a `/auth/callback`, que canjea el `code` (PKCE, cliente `@supabase/ssr` con sesión en cookies) y redirige a `/dashboard`; los errores se muestran en `/login`. Probado con tests; pendiente de verificar contra un Supabase real (añadir `<origen>/auth/callback` a las Redirect URLs del proyecto). Ver R1 en `docs/32_TEXTOS_VS_REALIDAD.md`
- `src/proxy.ts` protege todas las rutas salvo login, callbacks de auth y ficheros PWA; falla cerrado si falta configuración
- Validación de entrada en formularios: catálogos, límites de longitud, fotos ≤ 10 MB JPEG/PNG/WebP
- Fotos en bucket privado scoped por org_id (`<org_id>/<uuid>.<ext>`)
- Policies RLS (tablas y `storage.objects`) y FK por organización probadas en `tests/db/` sobre Postgres real; CI en GitHub Actions
