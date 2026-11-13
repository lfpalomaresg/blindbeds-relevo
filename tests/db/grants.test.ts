/**
 * Privilegios de tablas y ACL de funciones (supabase/migrations/000011_grants.sql).
 *
 * Contexto (01/11/2026): el proyecto cloud `relevo` se creó con «exponer tablas
 * nuevas» DESACTIVADO, así que no hay privilegios por defecto sobre `public`.
 * Las migraciones no traían GRANT de tablas y la app recibía 42501. Se arregló
 * A MANO en producción con `grant all on all tables/sequences/functions ... to
 * anon, authenticated, service_role`, lo que además deshizo los REVOKE de
 * 000005–000010 (p. ej. anon podía ejecutar handover_author_emails).
 *
 * 000011 deja en el repo lo que la app necesita y restaura las ACL de funciones:
 *  A) Proyecto sin privilegios por defecto + todas las migraciones → la app
 *     (authenticated) puede leer/escribir las tablas; RLS sigue activo.
 *  B) Proyecto con la deriva del grant manual + 000011 → las funciones vuelven
 *     a su ACL de diseño.
 *  C) 000011 es idempotente (se puede reaplicar sobre producción).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { STUBS, applyFiles, migrationFile, migrationFiles } from "../harness/db";
import { gatePg, startEphemeralPostgres, type EphemeralPostgres } from "../harness/pg";

const available = gatePg("grants.test");

/** Lo que hace Supabase cuando «exponer tablas nuevas» está desactivado. */
const NO_DEFAULT_PRIVILEGES = `
  alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
  alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
  alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;
`;

/** El arreglo manual aplicado en producción el 01/11 (la deriva). */
const MANUAL_DRIFT = `
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant all on all sequences in schema public to anon, authenticated, service_role;
  grant all on all functions in schema public to anon, authenticated, service_role;
`;

type Expected = { anon: boolean; authenticated: boolean; service_role: boolean };

const FUNCTION_ACL: Record<string, Expected> = {
  "public.change_ticket_status(uuid, text, text)": { anon: false, authenticated: true, service_role: true },
  "public.resolve_handover_item(uuid)": { anon: false, authenticated: true, service_role: false },
  // 000016: borrado de un ítem por el admin; exige auth.uid().
  "public.delete_handover_item(uuid)": { anon: false, authenticated: true, service_role: false },
  // Exige auth.uid(): service_role no tiene usuario, no la necesita.
  "public.create_ticket(uuid, text, text, text, uuid, text, text)": { anon: false, authenticated: true, service_role: false },
  // 000014: definer que exige auth.uid(); service_role no la necesita.
  "public.create_handover(uuid, text, text, jsonb)": { anon: false, authenticated: true, service_role: false },
  // 000021: misma protección + clave de idempotencia (la usa la app).
  "public.create_handover_idempotent(uuid, text, text, jsonb, uuid)": { anon: false, authenticated: true, service_role: false },
  "public.handover_author_emails(uuid, uuid[])": { anon: false, authenticated: true, service_role: false },
  "public.ticket_author_emails(uuid, uuid[])": { anon: false, authenticated: true, service_role: false },
  "public.purge_expired_handovers()": { anon: false, authenticated: false, service_role: true },
  "public.purge_expired_item_deletions()": { anon: false, authenticated: false, service_role: true },
  // 000020: rastro de borrados de solo lectura para el admin; exige auth.uid().
  "public.handover_item_deletion_log(uuid)": { anon: false, authenticated: true, service_role: false },
};

async function publicTables(db: Client): Promise<string[]> {
  const { rows } = await db.query<{ t: string }>(
    `select format('%I.%I', schemaname, tablename) as t from pg_tables where schemaname = 'public' order by 1`,
  );
  return rows.map((r) => r.t);
}

async function canExecute(db: Client, role: string, fn: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'EXECUTE') as ok`, [role, fn]);
  return rows[0].ok;
}

/** Únicas funciones de public que anon puede ejecutar: los helpers de RLS (las
 * policies sin `to` también se evalúan para anon; sin sesión devuelven vacío/false). */
const ANON_ALLOWED = ["public.get_user_org_ids()", "public.has_org_role(uuid,text)"];

async function publicFunctions(db: Client): Promise<string[]> {
  const { rows } = await db.query<{ f: string }>(
    `select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' order by 1`,
  );
  return rows.map((r) => (r.f.startsWith("public.") ? r.f : `public.${r.f}`));
}

async function expectFunctionAcl(db: Client) {
  for (const [fn, expected] of Object.entries(FUNCTION_ACL)) {
    for (const role of ["anon", "authenticated", "service_role"] as const) {
      expect({ fn, role, ok: await canExecute(db, role, fn) }).toEqual({ fn, role, ok: expected[role] });
    }
  }
  // Todas las funciones de public, no solo las de la lista: anon no ejecuta nada
  // salvo los helpers de RLS.
  const all = await publicFunctions(db);
  expect(all.length).toBeGreaterThanOrEqual(9);
  const anonCan: string[] = [];
  for (const fn of all) if (await canExecute(db, "anon", fn)) anonCan.push(fn);
  expect(anonCan.sort()).toEqual([...ANON_ALLOWED].sort());
}

describe.skipIf(!available)("privilegios y ACL de funciones (000011_grants.sql)", () => {
  let pg: EphemeralPostgres;
  let admin: Client;
  const opened: Client[] = [];

  beforeAll(async () => {
    pg = await startEphemeralPostgres();
    admin = await pg.connect();
  }, 120_000);

  afterAll(async () => {
    for (const c of opened) await c.end();
    await admin?.end();
    await pg?.stop();
  });

  async function database(name: string, extraBeforeMigrations = ""): Promise<Client> {
    await admin.query(`create database ${name}`);
    const db = await pg.connect({ database: name });
    opened.push(db);
    await applyFiles(db, STUBS);
    if (extraBeforeMigrations) await db.query(extraBeforeMigrations);
    await applyFiles(db, migrationFiles());
    return db;
  }

  // Desde 000013 la app no escribe partes ni su historial (solo por RPC).
  const RPC_ONLY = new Set([
    "public.maintenance_tickets",
    "public.ticket_updates",
    "public.shift_handovers",
    "public.handover_items",
    // 000018: el rastro de borrados solo lo escribe delete_handover_item.
    "public.handover_item_deletions",
  ]);
  // (000014: relevos e items también solo por RPC: create_handover / resolve_handover_item.)
  const NO_UPDATE_DELETE = new Set<string>();

  it("A) sin privilegios por defecto, authenticated lee todas las tablas y escribe todas salvo partes e historial", async () => {
    const db = await database("grants_no_defaults", NO_DEFAULT_PRIVILEGES);
    const tables = await publicTables(db);
    expect(tables.length).toBeGreaterThanOrEqual(7);
    // has_table_privilege con varios privilegios es «alguno»: se comprueba uno a uno.
    for (const t of tables) {
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        for (const role of ["authenticated", "service_role"]) {
          const denied =
            role === "authenticated" &&
            ((priv !== "SELECT" && RPC_ONLY.has(t)) || ((priv === "UPDATE" || priv === "DELETE") && NO_UPDATE_DELETE.has(t)));
          const expected = !denied;
          const { rows } = await db.query<{ ok: boolean }>(`select has_table_privilege($1, $2, $3) as ok`, [role, t, priv]);
          expect({ t, role, priv, ok: rows[0].ok }).toEqual({ t, role, priv, ok: expected });
        }
      }
    }
  });

  it("A) RLS sigue activo en todas las tablas de public (los GRANT no lo sustituyen)", async () => {
    const db = await database("grants_rls_on", NO_DEFAULT_PRIVILEGES);
    const { rows } = await db.query<{ t: string }>(
      `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("A) sin privilegios por defecto, las funciones quedan con su ACL de diseño", async () => {
    const db = await database("grants_fn_no_defaults", NO_DEFAULT_PRIVILEGES);
    await expectFunctionAcl(db);
  });

  it("B) tras la deriva del grant manual, reaplicar 000011 + 000013…000020 restaura las ACL de funciones", async () => {
    const db = await database("grants_drift");
    await db.query(MANUAL_DRIFT);
    expect(await canExecute(db, "anon", "public.handover_author_emails(uuid, uuid[])")).toBe(true);
    await applyFiles(db, [migrationFile("000011"), migrationFile("000013"), migrationFile("000014"), migrationFile("000016"), migrationFile("000017"), migrationFile("000018"), migrationFile("000019"), migrationFile("000020"), migrationFile("000021")]);
    await expectFunctionAcl(db);
  });

  it("C) 000011 es idempotente", async () => {
    const db = await database("grants_idempotent", NO_DEFAULT_PRIVILEGES);
    await applyFiles(db, [migrationFile("000011"), migrationFile("000011")]);
    await expectFunctionAcl(db);
  });
});
