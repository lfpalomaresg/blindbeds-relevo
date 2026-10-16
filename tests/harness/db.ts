/**
 * Arranque común de los tests de `tests/db`: stubs de Supabase (SOLO tests),
 * TODAS las migraciones de `supabase/migrations/` en orden y el fixture.
 *
 * Añadir una migración = dejar el fichero en `supabase/migrations/`; todos los
 * ficheros de `tests/db` la aplican sin tocar nada más.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Client } from "pg";
import type { EphemeralPostgres } from "./pg";

export const ROOT = resolve(__dirname, "../..");
export const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");
export const FIXTURE = join(ROOT, "tests/harness/fixture.sql");

/** Entorno Supabase simulado. No son migraciones: nunca salen de tests/harness. */
export const STUBS = [
  join(ROOT, "tests/harness/supabase-stub.sql"),
  join(ROOT, "tests/harness/storage-stub.sql"),
];

/** Rutas absolutas de las migraciones, en el orden en que se aplican. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(MIGRATIONS_DIR, f));
}

export function migrationFile(prefix: string): string {
  const found = migrationFiles().find((f) => f.includes(`/${prefix}`));
  if (!found) throw new Error(`No migration starting with ${prefix} in ${MIGRATIONS_DIR}`);
  return found;
}

export async function applyFiles(client: Client, files: string[]): Promise<void> {
  for (const file of files) await client.query(readFileSync(file, "utf8"));
}

/** Stubs + todas las migraciones + fixture sobre la base `postgres` del cluster. */
export async function bootstrap(pg: EphemeralPostgres): Promise<void> {
  for (const file of [...STUBS, ...migrationFiles(), FIXTURE]) await pg.applySqlFile(file);
}

/** Crea una base de datos aparte (solo stubs) para probar migraciones sin tocar la principal. */
export async function freshDatabase(pg: EphemeralPostgres, admin: Client, name: string): Promise<Client> {
  await admin.query(`create database ${name}`);
  const client = await pg.connect({ database: name });
  await applyFiles(client, STUBS);
  return client;
}
