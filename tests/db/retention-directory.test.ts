/**
 * Retención de relevos (000008) y directorio de autores (000007) sobre
 * Postgres efímero.
 *
 * - purge_expired_handovers(): borra los relevos de más de 90 días (y sus
 *   ítems, por cascada). Solo la ejecuta el operador / pg_cron / service_role;
 *   un usuario de la app no puede.
 * - org_member_directory(org): user_id + email de los miembros de una org a la
 *   que pertenece quien llama. Fuera de su org: nada.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { bootstrap } from "../harness/db";
import { gatePg, startEphemeralPostgres, type EphemeralPostgres } from "../harness/pg";
import { ANON, RLS_VIOLATION, asUser, errorCodeAs, runAs, type Actor } from "../harness/rls";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const ORG_C = "00000000-0000-0000-0000-00000000000c";
const staffA = asUser("aaaaaaaa-0000-0000-0000-00000000001a");
const adminA = asUser("aaaaaaaa-0000-0000-0000-00000000003a");
const staffB = asUser("bbbbbbbb-0000-0000-0000-00000000001b");
const adminC = asUser("cccccccc-0000-0000-0000-00000000001c");
const outsider = asUser("99999999-0000-0000-0000-000000000099");
const SERVICE: Actor = { role: "service_role" };

const OLD = "60000000-0000-0000-0000-0000000000a1";
const RECENT = "60000000-0000-0000-0000-0000000000a2";
const OLD_B = "60000000-0000-0000-0000-0000000000b1";

const available = gatePg("retention-directory.test");

describe.skipIf(!available)("retención de relevos (000008) y directorio de autores (000007)", () => {
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

  async function seedAged() {
    await owner.query(
      `insert into public.shift_handovers (id, org_id, department, shift_type, created_by, created_at) values
         ($1, $4, 'otro', 'noche', 'aaaaaaaa-0000-0000-0000-00000000001a', now() - interval '91 days'),
         ($2, $4, 'otro', 'noche', 'aaaaaaaa-0000-0000-0000-00000000001a', now() - interval '89 days'),
         ($3, $5, 'otro', 'tarde', 'bbbbbbbb-0000-0000-0000-00000000001b', now() - interval '400 days')`,
      [OLD, RECENT, OLD_B, ORG_A, ORG_B],
    );
    await owner.query(
      `insert into public.handover_items (handover_id, org_id, block, content) values
         ($1, $4, 'pendientes', 'Antiguo'), ($2, $4, 'avisos', 'Reciente'), ($3, $5, 'avisos', 'Antiguo B')`,
      [OLD, RECENT, OLD_B, ORG_A, ORG_B],
    );
  }

  afterEach(async () => {
    await owner.query(`delete from public.shift_handovers where department = 'otro'`);
  });

  async function ids() {
    const r = await owner.query(`select id from public.shift_handovers order by id`);
    return r.rows.map((x) => x.id as string);
  }

  it("borra los relevos de más de 90 días de TODAS las orgs, con sus ítems, y devuelve cuántos", async () => {
    await seedAged();
    const r = await runAs(owner, SERVICE, async (q) => {
      const res = await q<{ n: number }>(`select public.purge_expired_handovers() as n`);
      return { n: res.rows[0].n, left: (await q(`select id from public.shift_handovers where department = 'otro'`)).rows };
    });
    // runAs revierte: comprobamos dentro de la transacción.
    expect(r.n).toBe(2);
    expect(r.left.map((x) => x.id)).toEqual([RECENT]);
  });

  it("confirmado (como pg_cron, superusuario): quedan el reciente y el fixture; los ítems antiguos desaparecen", async () => {
    await seedAged();
    const res = await owner.query(`select public.purge_expired_handovers() as n`);
    expect(res.rows[0].n).toBe(2);
    expect(await ids()).toEqual(expect.arrayContaining([RECENT, "10000000-0000-0000-0000-00000000000a", "10000000-0000-0000-0000-00000000000b"]));
    expect(await ids()).not.toContain(OLD);
    const items = await owner.query(`select content from public.handover_items where content like 'Antiguo%'`);
    expect(items.rows).toEqual([]);
  });

  it("sin relevos caducados no borra nada", async () => {
    const res = await owner.query(`select public.purge_expired_handovers() as n`);
    expect(res.rows[0].n).toBe(0);
  });

  it("ni anon ni un usuario de la app (aunque sea admin) pueden ejecutarla", async () => {
    for (const actor of [ANON, staffA, adminA]) {
      expect(await errorCodeAs(owner, actor, `select public.purge_expired_handovers()`)).toBe(RLS_VIOLATION);
    }
  });

  it("directorio: un miembro ve user_id + email de los miembros de su org", async () => {
    const rows = await runAs(owner, staffA, async (q) =>
      (await q(`select user_id, email from public.org_member_directory($1) order by email`, [ORG_A])).rows,
    );
    expect(rows).toEqual([
      { user_id: "aaaaaaaa-0000-0000-0000-00000000003a", email: "admin.alfa@example.test" },
      { user_id: "aaaaaaaa-0000-0000-0000-00000000001a", email: "staff.alfa@example.test" },
      { user_id: "aaaaaaaa-0000-0000-0000-00000000002a", email: "supervisor.alfa@example.test" },
    ]);
  });

  it("directorio: fuera de su org, sin membership o con la org suspendida, no ve nada", async () => {
    const count = (actor: Actor, org: string) =>
      runAs(owner, actor, async (q) => (await q(`select * from public.org_member_directory($1)`, [org])).rows.length);
    expect(await count(staffB, ORG_A)).toBe(0);
    expect(await count(staffA, ORG_B)).toBe(0);
    expect(await count(outsider, ORG_A)).toBe(0);
    expect(await count(adminC, ORG_C)).toBe(0);
  });

  it("directorio: anon no puede ejecutarlo", async () => {
    expect(await errorCodeAs(owner, ANON, `select * from public.org_member_directory($1)`, [ORG_A])).toBe(RLS_VIOLATION);
  });
});
