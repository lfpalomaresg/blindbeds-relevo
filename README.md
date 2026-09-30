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
| Tests | Vitest |
| PWA | Manifest + service worker ready |

## Estructura

```
src/
├── app/
│   ├── login/          # Login con magic link
│   ├── dashboard/      # Panel principal (pendientes + averías)
│   ├── handover/new/   # Nuevo relevo de turno
│   ├── tickets/new/    # Nuevo parte de avería
│   └── auth/callback/  # Callback de Supabase Auth
├── components/
│   ├── auth/           # LoginForm
│   ├── handover/       # HandoverForm, PendingItems
│   └── tickets/        # TicketForm, TicketList
├── lib/
│   ├── supabase/       # client, server, admin
│   └── org.ts          # Lógica de organización
├── types/              # Tipos compartidos
└── hooks/              # useAuth
supabase/
└── migrations/         # 000001_baseline.sql
tests/                  # Vitest
```

## Arranque local

```bash
npm install
cp .env.example .env.local   # Rellenar con credenciales de Supabase
npm run dev                   # http://localhost:3000
npm test                      # Tests
```

## Migraciones

```bash
npx supabase db push          # Aplica migraciones a Supabase
```

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
- Middleware protege todas las rutas excepto /login
- Fotos en bucket privado scoped por org_id