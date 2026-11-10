/**
 * Retención del rastro de borrados de ítems del relevo (000019) sobre Postgres
 * efímero.
 *
 * purge_expired_item_deletions(): borra los asientos de handover_item_deletions
 * (000018) con más de 2 años (plazo provisional, pendiente de confirmar por el
 * operador) de TODAS las orgs y devuelve cuántos. Solo la ejecutan el operador,
 * pg_cron o service_role; un usuario de la app (ni siquiera admin) no.
 *
 * Datos 100 % sintéticos (fixture con dominios example.test).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { bootstrap } from "../harness/db";
import { gatePg, startEphemeralPostgres, type EphemeralPostgres } from "../harness/pg";
import { ANON, RLS_VIOLATION, asUser, errorCodeAs, runAs, type Actor } from "../harness/rls";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const adminA = asUser("aaaaaaaa-0000-0000-0000-00000000003a");
const SERVICE: Actor = { role: "service_role" };
const DELETER = "aaaaaaaa-0000-0000-0000-00000000003a";

const OLD_A = "70000000-0000-0000-0000-0000000000a1";
const RECENT_A = "70000000-0000-0000-0000-0000000000a2";
const OLD_B = "70000000-0000-0000-0000-0000000000b1";
const PURGE = `select public.purge_expired_item_deletions() as n`;

const available = gatePg("item-deletions-retention.test");

describe.skipIf(!available)("retención del rastro de borrados (000019): 2 años", () => {
  let pg: EphemeralPostgres;
  let owner: Client;

  beforeAll(async () => {
    pg = await startEphemeralPostgres();
    await bootstrap(pg);
    owner = await pg.connect();
  }, 120_000);

  afterAll(async () => {
    await owner?.end();
    await pg?.stop();
  });

  async function seed() {
    await owner.query(
      `insert into public.handover_item_deletions (id, org_id, handover_id, item_id, block, deleted_by, deleted_at) values
         ($1, $4, gen_random_uuid(), gen_random_uuid(), 'vips', $6, now() - interval '2 years' - interval '1 day'),
         ($2, $4, gen_random_uuid(), gen_random_uuid(), 'avisos', $6, now() - interval '2 years' + interval '1 day'),
         ($3, $5, gen_random_uuid(), gen_random_uuid(), 'pendientes', $6, now() - interval '5 years')`,
      [OLD_A, RECENT_A, OLD_B, ORG_A, ORG_B, DELETER],
    );
  }

  afterEach(async () => {
    await owner.query(`delete from public.handover_item_deletions`);
  });

  it("borra los asientos de más de 2 años de TODAS las orgs y devuelve cuántos; conserva los recientes", async () => {
    await seed();
    const r = await runAs(owner, SERVICE, async (q) => {
      const res = await q<{ n: number }>(PURGE);
      return { n: res.rows[0].n, left: (await q(`select id from public.handover_item_deletions order by id`)).rows };
    });
    expect(r.n).toBe(2);
    expect(r.left.map((x) => x.id)).toEqual([RECENT_A]);
  });

  it("sin asientos caducados no borra nada (devuelve 0)", async () => {
    await owner.query(
      `insert into public.handover_item_deletions (org_id, handover_id, item_id, block, deleted_by) values ($1, gen_random_uuid(), gen_random_uuid(), 'vips', $2)`,
      [ORG_A, DELETER],
    );
    const n = await runAs(owner, SERVICE, async (q) => (await q<{ n: number }>(PURGE)).rows[0].n);
    expect(n).toBe(0);
  });

  it("un usuario de la app (admin incluido) y anon no pueden ejecutarla", async () => {
    await seed();
    expect(await errorCodeAs(owner, adminA, PURGE)).toBe(RLS_VIOLATION);
    expect(await errorCodeAs(owner, ANON, PURGE)).toBe(RLS_VIOLATION);
    const left = await owner.query(`select count(*)::int as n from public.handover_item_deletions`);
    expect(left.rows[0].n).toBe(3);
  });

  it("es security invoker con search_path vacío (no eleva privilegios)", async () => {
    const r = await owner.query(
      `select p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'purge_expired_item_deletions'`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].prosecdef).toBe(false);
    expect(r.rows[0].proconfig).toContain('search_path=""');
  });
});
