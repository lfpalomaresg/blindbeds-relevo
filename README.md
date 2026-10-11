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
| PWA | Manifest + service worker ready |

## Estructura

```
src/
├── app/
│   ├── login/          # Login con magic link
│   ├── dashboard/      # Panel principal (pendientes + averías)
│   ├── handover/new/   # Nuevo relevo de turno
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
├── migrations/         # 000001_baseline.sql (lo único que se aplica)
└── variants/           # 000002: variante «proyecto compartido APPCC», NO aplicar
tests/
├── db/                 # Matriz RLS sobre Postgres efímero (initdb + pg_ctl)
├── harness/            # Arranque de Postgres, stub Supabase, fixture, fake client
├── components/         # jsdom + Testing Library
├── api/                # Route handlers de auth y proxy
└── scripts/            # setup-supabase-pro.sh con psql falso
docs/
├── 10_SESSION_NOTES.md
└── 20_ACTIVACION_SUPABASE.md  # Runbook de activación (1 hora)
```

## Arranque local

```bash
npm install
cp .env.local.example .env.local   # Rellenar con credenciales de Supabase
npm run dev                         # http://localhost:3000
npm test                            # Tests (RLS se omite con aviso si no hay Postgres)
npm run test:rls                    # Solo matriz RLS; exige initdb/pg_ctl instalados
```

## Migraciones

```bash
./scripts/setup-supabase-pro.sh   # Aplica baseline + seed y verifica (ver docs/20_ACTIVACION_SUPABASE.md)
npx supabase db push              # Alternativa: aplica supabase/migrations/ con la CLI
```

Antes de tocar un Supabase real, `npm run test:rls` aplica la migración sobre un
Postgres efímero local y comprueba las policies para staff / supervisor / admin.

## Despliegue

1. Crear proyecto en Vercel conectado a este repo
2. Configurar env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
3. Deploy

## Módulos

### Handover (FR-005)
Formulario estructurado de 4 bloques (pendientes, VIPs, incidencias, avisos) que cada empleado rellena al terminar su turno. Los items no resueltos persisten hasta que alguien los cierra.

### Averías (FR-006)
Parte de avería con foto obligatoria, prioridad, y trazabilidad completa por activo. QR scannable por habitación/equipo.

## Seguridad

- RLS en las 7 tablas públicas con políticas por organización
- Auth vía Supabase con magic link (sin contraseñas)
- `src/proxy.ts` protege todas las rutas salvo login, callbacks de auth y ficheros PWA; falla cerrado si falta configuración
- Validación de entrada en formularios: catálogos, límites de longitud, fotos ≤ 10 MB JPEG/PNG/WebP
- Fotos en bucket privado scoped por org_id (`<org_id>/<uuid>.<ext>`)
- Policies RLS probadas en `tests/db/rls.test.ts` sobre Postgres real