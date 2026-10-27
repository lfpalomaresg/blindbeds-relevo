/**
 * Retención de relevos (000008) y emails de autores de relevos (000007) sobre
 * Postgres efímero.
 *
 * - purge_expired_handovers(): borra los relevos de más de 90 días (y sus
 *   ítems, por cascada). Solo la ejecuta el operador / pg_cron / service_role;
 *   un usuario de la app no puede.
 * - handover_author_emails(org, ids): user_id + email SOLO de los ids pedidos
 *   que sean autores de relevos de una org a la que pertenece quien llama.
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

describe.skipIf(!available)("retención de relevos (000008) y emails de autores (000007)", () => {
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

  // ─── handover_author_emails (000007) ───
  // Minimización: solo emails de AUTORES de relevos de la org del llamante y,
  // de esos, solo los ids pedidos (los de la lista que está viendo).
  const AUTHORS = `select user_id, email from public.handover_author_emails($1, $2::uuid[]) order by email`;
  const STAFF_A = "aaaaaaaa-0000-0000-0000-00000000001a";
  const SUPER_A = "aaaaaaaa-0000-0000-0000-00000000002a";
  const ADMIN_A = "aaaaaaaa-0000-0000-0000-00000000003a";
  const STAFF_B = "bbbbbbbb-0000-0000-0000-00000000001b";

  it("autores: un miembro ve el email de los autores pedidos que tienen relevos en su org", async () => {
    const rows = await runAs(owner, adminA, async (q) => (await q(AUTHORS, [ORG_A, [STAFF_A]])).rows);
    expect(rows).toEqual([{ user_id: STAFF_A, email: "staff.alfa@example.test" }]);
  });

  it("autores: un miembro de la org que NO ha escrito relevos no aparece (no es un directorio)", async () => {
    // supervisor y admin de alfa son miembros pero no autores en el fixture.
    const rows = await runAs(owner, staffA, async (q) => (await q(AUTHORS, [ORG_A, [STAFF_A, SUPER_A, ADMIN_A]])).rows);
    expect(rows.map((r) => r.user_id)).toEqual([STAFF_A]);
  });

  it("autores: un id no pedido no se devuelve aunque sea autor", async () => {
    const rows = await runAs(owner, staffA, async (q) => (await q(AUTHORS, [ORG_A, [SUPER_A]])).rows);
    expect(rows).toEqual([]);
  });

  it("autores: el autor de relevos de OTRA org no sale aunque se pida su id", async () => {
    const rows = await runAs(owner, staffA, async (q) => (await q(AUTHORS, [ORG_A, [STAFF_B]])).rows);
    expect(rows).toEqual([]);
  });

  it("autores: fuera de su org, sin membership o con la org suspendida, no ve nada", async () => {
    const count = (actor: Actor, org: string, ids: string[]) =>
      runAs(owner, actor, async (q) => (await q(AUTHORS, [org, ids])).rows.length);
    expect(await count(staffB, ORG_A, [STAFF_A])).toBe(0);
    expect(await count(staffA, ORG_B, [STAFF_B])).toBe(0);
    expect(await count(outsider, ORG_A, [STAFF_A])).toBe(0);
    expect(await count(adminC, ORG_C, ["cccccccc-0000-0000-0000-00000000001c"])).toBe(0);
  });

  it("autores: lista de ids vacía o nula no devuelve nada", async () => {
    expect(await runAs(owner, staffA, async (q) => (await q(AUTHORS, [ORG_A, []])).rows.length)).toBe(0);
    expect(await runAs(owner, staffA, async (q) => (await q(AUTHORS, [ORG_A, null])).rows.length)).toBe(0);
  });

  it("autores: anon no puede ejecutarla", async () => {
    expect(await errorCodeAs(owner, ANON, AUTHORS, [ORG_A, [STAFF_A]])).toBe(RLS_VIOLATION);
  });

  it("el directorio completo de miembros (org_member_directory) ya no existe", async () => {
    const r = await owner.query(`select count(*)::int as n from pg_proc where proname = 'org_member_directory'`);
    expect(r.rows[0].n).toBe(0);
  });

  // ─── Catálogo: atributos de seguridad y ACL exacta ───
  async function catalog(signature: string) {
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
      [signature],
    );
    return r.rows[0] as { prosecdef: boolean; proconfig: string[] | null; executors: string[] };
  }

  it("catálogo: handover_author_emails es security definer, search_path vacío y EXECUTE solo para authenticated", async () => {
    const c = await catalog("public.handover_author_emails(uuid, uuid[])");
    expect(c.prosecdef).toBe(true);
    expect(c.proconfig).toEqual(['search_path=""']);
    expect(c.executors).toEqual(["authenticated"]);
  });

  it("catálogo: purge_expired_handovers es security invoker, search_path vacío y EXECUTE solo para service_role", async () => {
    const c = await catalog("public.purge_expired_handovers()");
    expect(c.prosecdef).toBe(false);
    expect(c.proconfig).toEqual(['search_path=""']);
    expect(c.executors).toEqual(["service_role"]);
  });
});
