#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Blindbeds Relevo — Setup Supabase Pro (llave en mano)
# ═══════════════════════════════════════════════════════════════════════════════
# Prerequisitos:
#   1. El operador ha creado una organización NUEVA en Supabase ($25/mes)
#   2. Ha creado el proyecto "blindbeds-relevo" dentro de esa org
#   3. Ha copiado las claves en .env.local (ver .env.local.example)
#
# Uso:
#   ./scripts/setup-supabase-pro.sh
#
# Lo que hace:
#   - Aplica las migraciones de supabase/migrations/ en orden (baseline + secuenciales)
#   - Carga el seed de demo
#   - Verifica que las tablas y policies existen
#   - Imprime las env vars necesarias para Vercel
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── 0. Prerrequisitos locales ────────────────────────────────────────────────

if ! command -v psql >/dev/null 2>&1; then
  echo "❌  psql no encontrado. Instala el cliente de PostgreSQL (postgresql-client) y vuelve a ejecutar."
  exit 1
fi

if [ ! -f .env.local ]; then
  echo "❌  .env.local no encontrado. Copia .env.local.example y rellena las claves."
  exit 1
fi

# shellcheck disable=SC1091
source .env.local

: "${NEXT_PUBLIC_SUPABASE_URL:?Falta NEXT_PUBLIC_SUPABASE_URL en .env.local}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Falta SUPABASE_SERVICE_ROLE_KEY en .env.local}"

# Extraer host de la URL para psql
# Formato: https://abcxyz.supabase.co → db.abcxyz.supabase.co
PROJECT_ID=$(echo "$NEXT_PUBLIC_SUPABASE_URL" | sed 's|https://||' | sed 's|\.supabase\.co.*||')
DB_HOST="db.${PROJECT_ID}.supabase.co"
DB_URL="postgresql://postgres:${SUPABASE_DB_PASSWORD:?Falta SUPABASE_DB_PASSWORD}@${DB_HOST}:5432/postgres"

echo "🔗  Conectando a: ${DB_HOST}"

# ── 1. Aplicar migraciones (baseline + secuenciales, en orden) ──────────────
# Solo supabase/migrations/: la variante de supabase/variants/ nunca se aplica aquí.

echo ""
for MIGRATION in supabase/migrations/*.sql; do
  echo "📋  Aplicando ${MIGRATION##*/} …"
  psql "$DB_URL" -f "$MIGRATION" -q
done
echo "✅  Migraciones aplicadas"

# ── 2. Cargar seed de demo ───────────────────────────────────────────────────

echo ""
echo "🌱  Cargando seed de demo …"
psql "$DB_URL" -f scripts/seed-demo.sql -q
echo "✅  Seed de demo cargado"

# ── 3. Verificar tablas ──────────────────────────────────────────────────────

echo ""
echo "🔍  Verificando tablas …"
TABLES=(organizations memberships shift_handovers handover_items ticket_assets maintenance_tickets ticket_updates)
for TABLE in "${TABLES[@]}"; do
  COUNT=$(psql "$DB_URL" -t -c "select count(*) from information_schema.tables where table_schema='public' and table_name='${TABLE}'" | tr -d ' ')
  if [ "$COUNT" = "1" ]; then
    echo "  ✅  $TABLE"
  else
    echo "  ❌  $TABLE — NO ENCONTRADA"
    exit 1
  fi
done

# ── 4. Verificar RLS activo en todas las tablas ─────────────────────────────

echo ""
echo "🔒  Verificando RLS …"
for TABLE in "${TABLES[@]}"; do
  RLS=$(psql "$DB_URL" -t -c "select rowsecurity from pg_tables where schemaname='public' and tablename='${TABLE}'" | tr -d ' ')
  if [ "$RLS" = "t" ]; then
    echo "  ✅  $TABLE RLS activo"
  else
    echo "  ❌  $TABLE RLS DESACTIVADO"
    exit 1
  fi
done

# ── 5. Verificar bucket de fotos ─────────────────────────────────────────────

echo ""
echo "🪣  Verificando bucket ticket-photos …"
BUCKET=$(psql "$DB_URL" -t -c "select id from storage.buckets where id='ticket-photos'" | tr -d ' ')
if [ "$BUCKET" = "ticket-photos" ]; then
  echo "  ✅  Bucket ticket-photos creado (privado)"
else
  echo "  ❌  Bucket ticket-photos NO encontrado"
  exit 1
fi

# ── 6. Imprimir env vars para Vercel ─────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Variables para Vercel → Settings → Environment Variables"
echo "════════════════════════════════════════════════════════════════"
echo "  NEXT_PUBLIC_SUPABASE_URL      = $NEXT_PUBLIC_SUPABASE_URL"
echo "  NEXT_PUBLIC_SUPABASE_ANON_KEY = ${NEXT_PUBLIC_SUPABASE_ANON_KEY:-<pegar desde Supabase → API>}"
echo "  SUPABASE_SERVICE_ROLE_KEY     = (nunca a Vercel — solo en .env.local)"
echo ""
echo "  ⚠️   Nunca pegues SUPABASE_SERVICE_ROLE_KEY en Vercel."
echo "════════════════════════════════════════════════════════════════"

echo ""
echo "🎉  Setup completo. Ya puedes hacer 'git push' y crear el proyecto en Vercel."
