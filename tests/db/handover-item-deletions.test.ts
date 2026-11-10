/**
 * Registro de borrados de ítems del relevo
 * (supabase/migrations/000018_handover_item_deletions.sql) sobre Postgres
 * efímero.
 *
 * Contrato: cada borrado que hace delete_handover_item (000016) deja una fila en
 * public.handover_item_deletions con quién, cuándo, el relevo, el ítem y el
 * bloque. NUNCA el contenido borrado (la razón del borrado es quitar un dato
 * sensible). Los intentos que no borran no dejan fila. Solo el admin de un
 * hotel activo lee las filas de su hotel; nadie de la app las escribe, cambia
 * o borra directamente. Las filas sobreviven al borrado del relevo
 * (retención de 90 días, 000008).
 *
 * Datos 100 % sintéticos (fixture con dominios example.test).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { bootstrap, migrationFile } from "../harness/db";
import { gatePg, startEphemeralPostgres, type EphemeralPostgres } from "../harness/pg";
import { ANON, RLS_VIOLATION, asUser, countAs, errorCodeAs, type Actor } from "../harness/rls";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_C = "00000000-0000-0000-0000-00000000000c";
const staffA = asUser("aaaaaaaa-0000-0000-0000-00000000001a");
const supervisorA = asUser("aaaaaaaa-0000-0000-0000-00000000002a");
const adminA = asUser("aaaaaaaa-0000-0000-0000-00000000003a");
const staffB = asUser("bbbbbbbb-0000-0000-0000-00000000001b");
const adminC = asUser("cccccccc-0000-0000-0000-00000000001c");

const DEPT = "fb";
const SENSITIVE = "Texto con dato sensible ficticio";
const DELETE_CALL = `select public.delete_handover_item($1) as ok`;
const TABLE = "handover_item_deletions";

const available = gatePg("handover-item-deletions.test");

describe.skipIf(!available)("handover_item_deletions: rastro de los borrados del admin (000018)", () => {
  let pg: EphemeralPostgres;
  let owner: Client;
  let session: Client;
  let handoverId: string;
  let itemId: string;

  beforeAll(async () => {
    pg = await startEphemeralPostgres();
    await bootstrap(pg);
    owner = await pg.connect();
    session = await pg.connect();
  }, 120_000);

  afterAll(async () => {
    await session?.end();
    await owner?.end();
    await pg?.stop();
  });

  beforeEach(async () => {
    await owner.query(`delete from public.handover_item_deletions`);
    await owner.query(`delete from public.shift_handovers where department = $1`, [DEPT]);
    await owner.query(`update public.organizations set status = 'active' where id = $1`, [ORG_A]);
    const h = await owner.query(
      `insert into public.shift_handovers (org_id, department, shift_type, created_by) values ($1, $2, 'noche', $3) returning id`,
      [ORG_A, DEPT, staffA.userId],
    );
    handoverId = h.rows[0].id;
    const i = await owner.query(
      `insert into public.handover_items (handover_id, org_id, block, content) values ($1, $2, 'pendientes', $3) returning id`,
      [handoverId, ORG_A, SENSITIVE],
    );
    itemId = i.rows[0].id;
  });

  async function autocommitAs(actor: Actor, text: string, values: unknown[]) {
    const claims = JSON.stringify(actor.userId ? { sub: actor.userId, role: actor.role } : { role: actor.role });
    await session.query("select set_config('request.jwt.claims', $1, false)", [claims]);
    await session.query("select set_config('request.jwt.claim.sub', $1, false)", [actor.userId ?? ""]);
    await session.query(`set role ${actor.role}`);
    try {
      return await session.query(text, values);
    } finally {
      await session.query("reset role");
    }
  }

  async function logRows() {
    const r = await owner.query(`select * from public.handover_item_deletions order by deleted_at`);
    return r.rows;
  }

  it("un borrado del admin deja una fila: quién, cuándo, relevo, ítem y bloque", async () => {
    const before = new Date();
    expect((await autocommitAs(adminA, DELETE_CALL, [itemId])).rows[0].ok).toBe(true);
    const rows = await logRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      org_id: ORG_A,
      handover_id: handoverId,
      item_id: itemId,
      block: "pendientes",
      deleted_by: adminA.userId,
    });
    expect((rows[0].deleted_at as Date).getTime()).toBeGreaterThanOrEqual(before.getTime() - 5_000);
  });

  it("no guarda el contenido borrado: ninguna columna lo contiene", async () => {
    await autocommitAs(adminA, DELETE_CALL, [itemId]);
    const cols = await owner.query(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by 1`,
      [TABLE],
    );
    expect(cols.rows.map((c) => c.column_name)).toEqual(["block", "deleted_at", "deleted_by", "handover_id", "id", "item_id", "org_id"]);
    const rows = await logRows();
    expect(JSON.stringify(rows)).not.toContain(SENSITIVE);
  });

  it("los intentos que no borran no dejan fila (staff, supervisor, otro hotel, inexistente, segundo borrado)", async () => {
    for (const actor of [staffA, supervisorA, adminC]) {
      expect((await autocommitAs(actor, DELETE_CALL, [itemId])).rows[0].ok).toBe(false);
    }
    expect((await autocommitAs(adminA, DELETE_CALL, ["00000000-0000-0000-0000-0000000000ff"])).rows[0].ok).toBe(false);
    expect(await logRows()).toHaveLength(0);

    expect((await autocommitAs(adminA, DELETE_CALL, [itemId])).rows[0].ok).toBe(true);
    expect((await autocommitAs(adminA, DELETE_CALL, [itemId])).rows[0].ok).toBe(false);
    expect(await logRows()).toHaveLength(1);
  });

  it("solo el admin de un hotel activo lee las filas de su hotel", async () => {
    await autocommitAs(adminA, DELETE_CALL, [itemId]);
    // Una fila de otro hotel (C, suspendido) para comprobar el aislamiento.
    await owner.query(
      `insert into public.handover_item_deletions (org_id, handover_id, item_id, block, deleted_by) values ($1, gen_random_uuid(), gen_random_uuid(), 'avisos', $2)`,
      [ORG_C, adminC.userId],
    );
    expect(await countAs(owner, adminA, TABLE)).toBe(1);
    expect(await countAs(owner, adminA, TABLE, `org_id = '${ORG_C}'`)).toBe(0);
    expect(await countAs(owner, staffA, TABLE)).toBe(0);
    expect(await countAs(owner, supervisorA, TABLE)).toBe(0);
    expect(await countAs(owner, staffB, TABLE)).toBe(0);
    expect(await countAs(owner, adminC, TABLE)).toBe(0);

    await owner.query(`update public.organizations set status = 'suspended' where id = $1`, [ORG_A]);
    expect(await countAs(owner, adminA, TABLE)).toBe(0);
  });

  it("anon no lee nada", async () => {
    await autocommitAs(adminA, DELETE_CALL, [itemId]);
    const code = await errorCodeAs(owner, ANON, `select count(*) from public.${TABLE}`);
    if (code === null) expect(await countAs(owner, ANON, TABLE)).toBe(0);
    else expect(code).toBe(RLS_VIOLATION);
  });

  it("nadie de la app escribe, cambia ni borra el registro directamente (ni el admin)", async () => {
    await autocommitAs(adminA, DELETE_CALL, [itemId]);
    const insert = `insert into public.${TABLE} (org_id, handover_id, item_id, block, deleted_by) values ('${ORG_A}', gen_random_uuid(), gen_random_uuid(), 'avisos', '${adminA.userId}')`;
    for (const sql of [insert, `update public.${TABLE} set block = 'avisos'`, `delete from public.${TABLE}`]) {
      for (const actor of [adminA, staffA, ANON]) {
        expect({ sql, actor: actor.userId ?? "anon", code: await errorCodeAs(owner, actor, sql) }).toEqual({
          sql,
          actor: actor.userId ?? "anon",
          code: RLS_VIOLATION,
        });
      }
    }
    expect(await logRows()).toHaveLength(1);
  });

  it("la fila sobrevive al borrado del relevo (retención de 90 días)", async () => {
    await autocommitAs(adminA, DELETE_CALL, [itemId]);
    await owner.query(`delete from public.shift_handovers where id = $1`, [handoverId]);
    const rows = await logRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].handover_id).toBe(handoverId);
  });

  it("la migración es idempotente: reaplicada, conserva las filas y sigue registrando", async () => {
    await autocommitAs(adminA, DELETE_CALL, [itemId]);
    await pg.applySqlFile(migrationFile("000018"));
    expect(await logRows()).toHaveLength(1);
    const i = await owner.query(
      `insert into public.handover_items (handover_id, org_id, block, content) values ($1, $2, 'avisos', 'Otro') returning id`,
      [handoverId, ORG_A],
    );
    expect((await autocommitAs(adminA, DELETE_CALL, [i.rows[0].id])).rows[0].ok).toBe(true);
    expect(await logRows()).toHaveLength(2);
  });
});
