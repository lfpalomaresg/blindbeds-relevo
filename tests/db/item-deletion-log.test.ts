/**
 * Vista de solo lectura del rastro de borrados para el admin
 * (supabase/migrations/000020_item_deletion_log.sql) sobre Postgres efímero.
 *
 * Contrato: handover_item_deletion_log(org) devuelve, solo al admin de un
 * hotel activo y solo de su hotel, quién borró (email), cuándo y de qué relevo
 * (id, fecha, departamento, turno) y el bloque. NUNCA el contenido borrado.
 * A staff, supervisor, otro hotel, hotel suspendido o anon: nada.
 *
 * Datos 100 % sintéticos (fixture con dominios example.test).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { bootstrap } from "../harness/db";
import { gatePg, startEphemeralPostgres, type EphemeralPostgres } from "../harness/pg";
import { ANON, RLS_VIOLATION, asUser, errorCodeAs, runAs, type Actor } from "../harness/rls";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const ORG_C = "00000000-0000-0000-0000-00000000000c";
const staffA = asUser("aaaaaaaa-0000-0000-0000-00000000001a");
const supervisorA = asUser("aaaaaaaa-0000-0000-0000-00000000002a");
const adminA = asUser("aaaaaaaa-0000-0000-0000-00000000003a");
const staffB = asUser("bbbbbbbb-0000-0000-0000-00000000001b");
const adminC = asUser("cccccccc-0000-0000-0000-00000000001c");

const DEPT = "pisos";
const SENSITIVE = "Texto con dato sensible ficticio";
const LOG = `select * from public.handover_item_deletion_log($1)`;
const SIGNATURE = "public.handover_item_deletion_log(uuid)";

const available = gatePg("item-deletion-log.test");

describe.skipIf(!available)("handover_item_deletion_log: rastro de borrados de solo lectura para el admin (000020)", () => {
  let pg: EphemeralPostgres;
  let owner: Client;
  let handoverId: string;

  beforeAll(async () => {
    pg = await startEphemeralPostgres();
    await bootstrap(pg);
    owner = await pg.connect();
  }, 120_000);

  afterAll(async () => {
    await owner?.end();
    await pg?.stop();
  });

  beforeEach(async () => {
    await owner.query(`delete from public.handover_item_deletions`);
    await owner.query(`delete from public.shift_handovers where department = $1`, [DEPT]);
    await owner.query(`update public.organizations set status = 'active' where id = $1`, [ORG_A]);
    const h = await owner.query(
      `insert into public.shift_handovers (org_id, department, shift_type, created_by) values ($1, $2, 'tarde', $3) returning id`,
      [ORG_A, DEPT, staffA.userId],
    );
    handoverId = h.rows[0].id;
    const i = await owner.query(
      `insert into public.handover_items (handover_id, org_id, block, content) values ($1, $2, 'vips', $3) returning id`,
      [handoverId, ORG_A, SENSITIVE],
    );
    // El borrado real, por la función del admin (000018): deja el asiento.
    await owner.query("begin");
    await owner.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: adminA.userId, role: "authenticated" })]);
    await owner.query("select set_config('request.jwt.claim.sub', $1, true)", [adminA.userId]);
    await owner.query("set local role authenticated");
    const ok = (await owner.query(`select public.delete_handover_item($1) as ok`, [i.rows[0].id])).rows[0].ok;
    await owner.query("commit");
    expect(ok).toBe(true);
    // Un asiento de otro hotel (B), para comprobar el aislamiento.
    await owner.query(
      `insert into public.handover_item_deletions (org_id, handover_id, item_id, block, deleted_by) values ($1, gen_random_uuid(), gen_random_uuid(), 'avisos', $2)`,
      [ORG_B, staffB.userId],
    );
  });

  async function logAs(actor: Actor, org = ORG_A) {
    return runAs(owner, actor, async (q) => (await q(LOG, [org])).rows);
  }

  it("el admin ve quién borró, cuándo y de qué relevo, con el bloque", async () => {
    const rows = await logAs(adminA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deleted_by_email: "admin.alfa@example.test",
      handover_id: handoverId,
      department: DEPT,
      shift_type: "tarde",
      block: "vips",
    });
    expect(rows[0].deleted_at).toBeInstanceOf(Date);
    expect(rows[0].handover_created_at).toBeInstanceOf(Date);
  });

  it("no devuelve el contenido borrado: solo las columnas de metadatos", async () => {
    const r = await runAs(owner, adminA, async (q) => q(LOG, [ORG_A]));
    expect(r.fields.map((f) => f.name).sort()).toEqual(
      ["block", "deleted_at", "deleted_by_email", "department", "handover_created_at", "handover_id", "shift_type"],
    );
    expect(JSON.stringify(r.rows)).not.toContain(SENSITIVE);
  });

  it("staff, supervisor, otro hotel y hotel suspendido no ven nada", async () => {
    for (const actor of [staffA, supervisorA, staffB, adminC]) {
      expect({ actor: actor.userId, rows: await logAs(actor) }).toEqual({ actor: actor.userId, rows: [] });
    }
    // Pedir el hotel B siendo admin de A tampoco da nada.
    expect(await logAs(adminA, ORG_B)).toEqual([]);
    // Ni el admin de C pidiendo su propio hotel (suspendido).
    expect(await logAs(adminC, ORG_C)).toEqual([]);
    // Ni el admin de A si su hotel pasa a suspendido.
    await owner.query(`update public.organizations set status = 'suspended' where id = $1`, [ORG_A]);
    expect(await logAs(adminA)).toEqual([]);
  });

  it("anon no la ejecuta", async () => {
    expect(await errorCodeAs(owner, ANON, LOG, [ORG_A])).toBe(RLS_VIOLATION);
  });

  it("si la retención ya borró el relevo, el asiento sigue con los datos del relevo vacíos", async () => {
    await owner.query(`delete from public.shift_handovers where id = $1`, [handoverId]);
    const rows = await logAs(adminA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ handover_id: handoverId, handover_created_at: null, department: null, shift_type: null, block: "vips" });
  });

  it("catálogo: security definer, search_path vacío y EXECUTE solo para authenticated", async () => {
    const r = await owner.query(
      `select p.prosecdef, p.proconfig,
              coalesce(array(
                select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
                  from aclexplode(p.proacl) a
                 where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
                 order by 1
              ), '{}') as executors
         from pg_proc p
        where p.oid = $1::regprocedure`,
      [SIGNATURE],
    );
    expect(r.rows[0]).toEqual({ prosecdef: true, proconfig: ['search_path=""'], executors: ["authenticated"] });
  });
});
