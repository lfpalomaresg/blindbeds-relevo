/**
 * Borrado manual de un ítem del relevo por el admin (MUST de minimización del
 * MVP: si se cuela un dato sensible en el texto libre, el admin del hotel lo
 * borra). supabase/migrations/000016_delete_handover_item.sql sobre Postgres
 * efímero.
 *
 * Contrato: delete_handover_item(id) → true si borró; false si el ítem no
 * existe o quien llama no es admin de un hotel activo al que pertenece el
 * ítem (no revela si existe). anon no puede ejecutarla. La app sigue sin
 * DELETE directo en handover_items (000014).
 *
 * Datos 100 % sintéticos (fixture con dominios example.test).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { bootstrap } from "../harness/db";
import { gatePg, startEphemeralPostgres, type EphemeralPostgres } from "../harness/pg";
import { ANON, RLS_VIOLATION, asUser, errorCodeAs, type Actor } from "../harness/rls";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const staffA = asUser("aaaaaaaa-0000-0000-0000-00000000001a");
const supervisorA = asUser("aaaaaaaa-0000-0000-0000-00000000002a");
const adminA = asUser("aaaaaaaa-0000-0000-0000-00000000003a");
const adminC = asUser("cccccccc-0000-0000-0000-00000000001c");

const DEPT = "fb";
const CALL = `select public.delete_handover_item($1) as ok`;

const available = gatePg("delete-handover-item.test");

describe.skipIf(!available)("delete_handover_item: el admin borra un ítem del relevo (000016)", () => {
  let pg: EphemeralPostgres;
  let owner: Client;
  let session: Client;
  let handoverId: string;
  let itemId: string;
  let otherItemId: string;

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
    await owner.query(`delete from public.shift_handovers where department = $1`, [DEPT]);
    await owner.query(`update public.organizations set status = 'active' where id = $1`, [ORG_A]);
    const h = await owner.query(
      `insert into public.shift_handovers (org_id, department, shift_type, created_by) values ($1, $2, 'noche', $3) returning id`,
      [ORG_A, DEPT, staffA.userId],
    );
    handoverId = h.rows[0].id;
    const i = await owner.query(
      `insert into public.handover_items (handover_id, org_id, block, content) values
         ($1, $2, 'pendientes', 'Texto con dato sensible ficticio'),
         ($1, $2, 'avisos', 'Grupo a las 16h')
       returning id`,
      [handoverId, ORG_A],
    );
    [itemId, otherItemId] = i.rows.map((r) => r.id as string);
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

  async function remainingItems(): Promise<string[]> {
    const r = await owner.query(`select id from public.handover_items where handover_id = $1 order by block`, [handoverId]);
    return r.rows.map((x) => x.id as string);
  }

  it("el admin del hotel borra el ítem: devuelve true, solo desaparece ese ítem y el relevo sigue", async () => {
    const r = await autocommitAs(adminA, CALL, [itemId]);
    expect(r.rows[0].ok).toBe(true);
    expect(await remainingItems()).toEqual([otherItemId]);
    const h = await owner.query(`select count(*)::int as n from public.shift_handovers where id = $1`, [handoverId]);
    expect(h.rows[0].n).toBe(1);
  });

  it("staff y supervisor no pueden borrar: false y no se borra nada", async () => {
    for (const actor of [staffA, supervisorA]) {
      const r = await autocommitAs(actor, CALL, [itemId]);
      expect(r.rows[0].ok).toBe(false);
    }
    expect((await remainingItems()).sort()).toEqual([itemId, otherItemId].sort());
  });

  it("el admin de OTRO hotel no puede borrar: false y no se borra nada", async () => {
    const r = await autocommitAs(adminC, CALL, [itemId]);
    expect(r.rows[0].ok).toBe(false);
    expect((await remainingItems()).sort()).toEqual([itemId, otherItemId].sort());
  });

  it("con el hotel inactivo, ni su admin puede borrar", async () => {
    await owner.query(`update public.organizations set status = 'suspended' where id = $1`, [ORG_A]);
    const r = await autocommitAs(adminA, CALL, [itemId]);
    expect(r.rows[0].ok).toBe(false);
    expect((await remainingItems()).sort()).toEqual([itemId, otherItemId].sort());
  });

  it("un ítem inexistente devuelve false; borrar dos veces el mismo, la segunda false", async () => {
    expect((await autocommitAs(adminA, CALL, ["00000000-0000-0000-0000-0000000000ff"])).rows[0].ok).toBe(false);
    expect((await autocommitAs(adminA, CALL, [itemId])).rows[0].ok).toBe(true);
    expect((await autocommitAs(adminA, CALL, [itemId])).rows[0].ok).toBe(false);
  });

  it("anon no puede ejecutarla", async () => {
    expect(await errorCodeAs(owner, ANON, CALL, [itemId])).toBe(RLS_VIOLATION);
    expect((await remainingItems()).sort()).toEqual([itemId, otherItemId].sort());
  });

  it("el DELETE directo sigue cerrado incluso para el admin (solo por RPC)", async () => {
    await expect(autocommitAs(adminA, `delete from public.handover_items where id = $1`, [itemId])).rejects.toMatchObject({
      code: RLS_VIOLATION,
    });
    expect((await remainingItems()).sort()).toEqual([itemId, otherItemId].sort());
  });
});
