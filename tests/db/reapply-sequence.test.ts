/**
 * Secuencia de reaplicación documentada en docs/20_ACTIVACION_SUPABASE.md:
 * 000011 (grants) → 000013 → 000014 → 000016 → 000017 → 000018 → 000019, sobre una base
 * ya migrada. Comprueba que, tras reaplicarla, siguen activos:
 *   - los límites de create_handover en el servidor (000017, error 22023);
 *   - el rastro de borrados (000018): delete_handover_item deja asiento y la
 *     app no escribe handover_item_deletions;
 *   - la purga del rastro solo para operador/service_role (000019).
 * Y, como contraste, que reaplicar solo 000011 y 000014 quita los límites y
 * devuelve a la app el PRIVILEGIO de escritura sobre el rastro (deriva de ACL;
 * RLS sigue frenando el insert): por eso la secuencia entera.
 *
 * Datos 100 % sintéticos (fixture con dominios example.test).
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { FIXTURE, applyFiles, freshDatabase, migrationFile, migrationFiles } from "../harness/db";
import { gatePg, startEphemeralPostgres, type EphemeralPostgres } from "../harness/pg";
import { RLS_VIOLATION, asUser, errorCodeAs, runAs } from "../harness/rls";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const staffA = asUser("aaaaaaaa-0000-0000-0000-00000000001a");
const adminA = asUser("aaaaaaaa-0000-0000-0000-00000000003a");

const SEQUENCE = ["000011", "000013", "000014", "000016", "000017", "000018", "000019"];
const FIVE_ITEMS = JSON.stringify(
  ["pendientes", "vips", "incidencias", "avisos", "pendientes"].map((block) => ({ block, content: "Texto ficticio" })),
);
const CREATE = `select public.create_handover($1, 'otro', 'noche', $2::jsonb) as id`;
const INSERT_LOG = `insert into public.handover_item_deletions (org_id, handover_id, item_id, block, deleted_by)
                    values ($1, gen_random_uuid(), gen_random_uuid(), 'vips', $2)`;
const PURGE = `select public.purge_expired_item_deletions()`;

async function appCanWriteLog(db: Client): Promise<boolean> {
  const r = await db.query<{ w: boolean }>(
    `select has_table_privilege('authenticated', 'public.handover_item_deletions', 'INSERT')
         or has_table_privilege('authenticated', 'public.handover_item_deletions', 'UPDATE')
         or has_table_privilege('authenticated', 'public.handover_item_deletions', 'DELETE') as w`,
  );
  return r.rows[0].w;
}

const available = gatePg("reapply-sequence.test");

describe.skipIf(!available)("reaplicación 000011 → 000013 → 000014 → 000016 → 000017 → 000018 → 000019", () => {
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

  /** Base migrada entera + fixture, y después reaplica `prefixes` en ese orden. */
  async function reapplied(name: string, prefixes: string[]): Promise<Client> {
    const db = await freshDatabase(pg, admin, name);
    opened.push(db);
    await applyFiles(db, migrationFiles());
    await db.query(readFileSync(FIXTURE, "utf8"));
    await applyFiles(db, prefixes.map(migrationFile));
    return db;
  }

  async function seedItem(db: Client): Promise<string> {
    const h = await db.query(
      `insert into public.shift_handovers (org_id, department, shift_type, created_by) values ($1, 'otro', 'noche', $2) returning id`,
      [ORG_A, staffA.userId],
    );
    const i = await db.query(
      `insert into public.handover_items (handover_id, org_id, block, content) values ($1, $2, 'vips', 'Dato ficticio') returning id`,
      [h.rows[0].id, ORG_A],
    );
    return i.rows[0].id as string;
  }

  it("tras la secuencia completa, límites, rastro y purga siguen activos", async () => {
    const db = await reapplied("reapply_full", SEQUENCE);

    // 000017: el servidor rechaza 5 bloques y sigue aceptando un relevo válido.
    expect(await errorCodeAs(db, staffA, CREATE, [ORG_A, FIVE_ITEMS])).toBe("22023");
    const ONE_ITEM = JSON.stringify([{ block: "avisos", content: "Texto ficticio" }]);
    expect(await errorCodeAs(db, staffA, CREATE, [ORG_A, ONE_ITEM])).toBeNull();

    // 000018: el borrado del admin deja asiento en la misma transacción.
    const itemId = await seedItem(db);
    const logged = await runAs(db, adminA, async (q) => {
      const ok = (await q<{ ok: boolean }>(`select public.delete_handover_item($1) as ok`, [itemId])).rows[0].ok;
      const rows = (await q(`select item_id, deleted_by from public.handover_item_deletions where item_id = $1`, [itemId])).rows;
      return { ok, rows };
    });
    expect(logged.ok).toBe(true);
    expect(logged.rows).toEqual([{ item_id: itemId, deleted_by: adminA.userId }]);

    // 000018: la app no tiene privilegio de escritura sobre el rastro (y RLS
    // tampoco la deja); 000019: ni ejecuta la purga.
    expect(await appCanWriteLog(db)).toBe(false);
    expect(await errorCodeAs(db, adminA, INSERT_LOG, [ORG_A, adminA.userId])).toBe(RLS_VIOLATION);
    expect(await errorCodeAs(db, adminA, PURGE)).toBe(RLS_VIOLATION);

    // 000019: service_role sí la ejecuta y borra solo lo caducado.
    await db.query(
      `insert into public.handover_item_deletions (org_id, handover_id, item_id, block, deleted_by, deleted_at) values
         ($1, gen_random_uuid(), gen_random_uuid(), 'vips', $2, now() - interval '2 years' - interval '1 day'),
         ($1, gen_random_uuid(), gen_random_uuid(), 'avisos', $2, now())`,
      [ORG_A, adminA.userId],
    );
    const purged = await runAs(db, { role: "service_role" }, async (q) => {
      const n = (await q<{ n: number }>(`select public.purge_expired_item_deletions() as n`)).rows[0].n;
      const left = (await q<{ c: number }>(`select count(*)::int as c from public.handover_item_deletions`)).rows[0].c;
      return { n, left };
    });
    expect(purged).toEqual({ n: 1, left: 1 });
  });

  it("contraste: reaplicar solo 000011 y 000014 quita los límites y devuelve a la app el privilegio (no la escritura efectiva) sobre el rastro", async () => {
    const db = await reapplied("reapply_partial", ["000011", "000014"]);
    // Barrera 1, ACL: 000011 concede INSERT/UPDATE/DELETE en todas las tablas
    // (deriva que 000018 retira de nuevo).
    expect(await appCanWriteLog(db)).toBe(true);
    // Barrera 2, RLS: sin policy de escritura, el insert sigue rechazado.
    expect(await errorCodeAs(db, adminA, INSERT_LOG, [ORG_A, adminA.userId])).toBe(RLS_VIOLATION);
    // 000014 redefine create_handover sin los límites de 000017.
    expect(await errorCodeAs(db, staffA, CREATE, [ORG_A, FIVE_ITEMS])).toBeNull();
  });
});
