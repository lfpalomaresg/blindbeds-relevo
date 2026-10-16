-- Stub mínimo del esquema `storage` de Supabase — SOLO PARA TESTS.
--
-- NO es una migración y nunca se aplica a un proyecto Supabase: allí el
-- esquema `storage` ya existe y pertenece a `supabase_storage_admin`. Vive en
-- tests/harness/ precisamente para que no se confunda con supabase/migrations/.
--
-- Reproduce lo justo para ejercitar las policies de
-- supabase/migrations/000003_storage_policies.sql sobre un Postgres "vanilla":
--   * storage.buckets con RLS activo y sin policies (como en Supabase);
--   * storage.objects con las columnas del esquema real que una policy puede
--     consultar (bucket_id, name, owner, owner_id, path_tokens, metadata…),
--     RLS ACTIVO y sin policies propias: sin migración, nadie salvo
--     service_role ve ni escribe nada;
--   * storage.foldername(name), con el mismo cuerpo que la función real;
--   * los GRANT que Supabase da a anon/authenticated/service_role, para que
--     un «denegado» en los tests lo decida RLS y no la falta de privilegios.
--
-- Lo que NO reproduce: la API de Storage (límite de tamaño y MIME del bucket,
-- que se aplican en el servicio y no en SQL), triggers internos, ni el rol
-- propietario. La verificación definitiva es contra un Supabase real
-- (docs/20_ACTIVACION_SUPABASE.md §6).

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  user_metadata jsonb
);

create unique index if not exists bucketid_objname on storage.objects (bucket_id, name);

-- Mismo cuerpo que storage.foldername() en Supabase: todos los segmentos de la
-- ruta menos el último (el nombre del fichero).
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
