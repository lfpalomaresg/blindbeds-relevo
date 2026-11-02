/**
 * Columnas protegidas del parte (supabase/migrations/000012_ticket_guard.sql).
 *
 * Careo Codex 01/11/2026 (hallazgos ALTA 1 y 2): la policy `tickets_update`
 * deja a cualquier miembro reescribir TODAS las columnas de un parte de su org.
 *  - `photo_path` → apuntar a una foto de otra org (`B/<uuid>.jpg`), cerrar el
 *    parte con fecha antigua y esperar a que el purgador (service_role) la borre.
 *  - `created_by` / `closed_by` → poner el UUID de un usuario de otra org y
 *    leer su email con `ticket_author_emails()`.
 *
 * Contrato tras 000012, para los roles de la app (anon/authenticated):
 *  - inmutables: org_id, created_by, created_at, photo_path;
 *  - `closed_by` solo puede pasar a ser quien ejecuta (auth.uid());
 *  - `closed_at` solo puede pasar a now() (lo que hace change_ticket_status);
 *  - `room_number`: recortado, no vacío y sin caracteres de control.
 * service_role (purgador) y el propietario siguen pudiendo vaciar photo_path.
 *
 * Desde 000013 la app ya no escribe la tabla (solo create_ticket /
 * change_ticket_status): estos tests reabren los permisos a propósito para
 * comprobar que el trigger y los CHECK aguantan como segunda barrera.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { bootstrap } from "../harness/db";
import { gatePg, startEphemeralPostgres, type EphemeralPostgres } from "../harness/pg";
import { asUser, errorCodeAs, runAs, type Actor } from "../harness/rls";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const staffA = asUser("aaaaaaaa-0000-0000-0000-00000000001a");
const adminA = asUser("aaaaaaaa-0000-0000-0000-00000000003a");
const STAFF_B = "bbbbbbbb-0000-0000-0000-00000000001b";
const SERVICE: Actor = { role: "service_role" };
const TICKET_A = "40000000-0000-0000-0000-00000000000a";

const DENIED = "42501";
const CHECK = "23514";

const available = gatePg("ticket-guard.test");

describe.skipIf(!available)("columnas protegidas del parte (000012_ticket_guard.sql)", () => {
  let pg: EphemeralPostgres;
  let db: Client;

  beforeAll(async () => {
    pg = await startEphemeralPostgres();
    await bootstrap(pg);
    db = await pg.connect();
    // Escenario «permisos reabiertos por error» (p. ej. otro `grant all` manual):
    // desde 000013 la app no escribe estas tablas, pero esta barrera tiene que
    // aguantar igualmente.
    await db.query(`grant insert, update, delete on public.maintenance_tickets, public.ticket_updates to anon, authenticated`);
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    await pg?.stop();
  });

  const upd = (set: string) => `update public.maintenance_tickets set ${set} where id = '${TICKET_A}'`;

  it("un miembro NO puede reescribir photo_path (ni a una ruta de otra org)", async () => {
    expect(await errorCodeAs(db, adminA, upd(`photo_path = '${ORG_B}/x.jpg'`))).toBe(DENIED);
    // Ni siquiera a una ruta de su propia org: la foto se fija al crear el parte.
    expect(await errorCodeAs(db, staffA, upd(`photo_path = '${ORG_A}/otra.jpg'`))).toBe(DENIED);
  });

  it("un miembro NO puede cambiar created_by", async () => {
    expect(await errorCodeAs(db, adminA, upd(`created_by = '${STAFF_B}'`))).toBe(DENIED);
  });

  it("closed_by solo puede ser quien ejecuta", async () => {
    expect(await errorCodeAs(db, adminA, upd(`closed_by = '${STAFF_B}'`))).toBe(DENIED);
    expect(await errorCodeAs(db, adminA, upd(`closed_by = '${adminA.userId}', closed_at = now(), status = 'cerrado'`))).toBeNull();
  });

  it("closed_at solo puede ser now() (no se puede fechar un cierre en el pasado)", async () => {
    expect(await errorCodeAs(db, adminA, upd(`closed_at = now() - interval '200 days'`))).toBe(DENIED);
  });

  it("coherencia de cierre: no se puede cerrar sin closed_by/closed_at ni rellenarlos sin cerrar (careo R2)", async () => {
    expect(await errorCodeAs(db, adminA, upd(`status = 'cerrado'`))).toBe(DENIED);
    expect(await errorCodeAs(db, adminA, upd(`status = 'cerrado', closed_by = '${adminA.userId}'`))).toBe(DENIED);
    expect(await errorCodeAs(db, adminA, upd(`closed_at = now()`))).toBe(DENIED);
    expect(await errorCodeAs(db, adminA, upd(`closed_by = '${adminA.userId}'`))).toBe(DENIED);
    expect(await errorCodeAs(db, adminA, upd(`status = 'en_curso'`))).toBeNull();
  });

  it("un parte cerrado no se reabre ni se re-fecha (careo R2)", async () => {
    const codes = await runAs(db, adminA, async (q) => {
      await q(`select public.change_ticket_status($1, 'abierto', 'cerrado')`, [TICKET_A]);
      const out: (string | null)[] = [];
      for (const stmt of [upd(`status = 'abierto', closed_by = null, closed_at = null`), upd(`status = 'en_curso'`), upd(`closed_at = now()`), upd(`title = 'sigue editable'`)]) {
        await q("savepoint s");
        try {
          await q(stmt);
          out.push(null);
        } catch (e) {
          out.push((e as { code?: string }).code ?? "unknown");
        }
        await q("rollback to savepoint s");
      }
      return out;
    });
    // closed_at = now() en la misma transacción es «sin cambio» (now() es el del cierre).
    expect(codes).toEqual([DENIED, DENIED, null, null]);
  });

  it("un miembro NO puede cambiar created_at", async () => {
    expect(await errorCodeAs(db, adminA, upd(`created_at = now() - interval '1 year'`))).toBe(DENIED);
  });

  it("ticket_author_emails no devuelve el email de un usuario de otra org", async () => {
    const emails = await runAs(db, adminA, async (q) => {
      await q(upd(`closed_by = '${STAFF_B}'`)).catch(() => undefined);
      return [];
    });
    expect(emails).toEqual([]);
    const leaked = await runAs(db, adminA, async (q) => {
      try {
        await q(upd(`created_by = '${STAFF_B}'`));
      } catch {
        return [];
      }
      const r = await q<{ email: string }>(`select email from public.ticket_author_emails($1, $2::uuid[])`, [ORG_A, [STAFF_B]]);
      return r.rows.map((x) => x.email);
    });
    expect(leaked).toEqual([]);
  });

  it("change_ticket_status sigue funcionando (en_curso y cerrado)", async () => {
    const ok = await runAs(db, staffA, async (q) => {
      const a = await q<{ ok: boolean }>(`select public.change_ticket_status($1, 'abierto', 'en_curso') as ok`, [TICKET_A]);
      const b = await q<{ ok: boolean }>(`select public.change_ticket_status($1, 'en_curso', 'cerrado') as ok`, [TICKET_A]);
      const t = await q<{ closed_by: string }>(`select closed_by from public.maintenance_tickets where id = $1`, [TICKET_A]);
      return [a.rows[0].ok, b.rows[0].ok, t.rows[0].closed_by];
    });
    expect(ok).toEqual([true, true, staffA.userId]);
  });

  it("los demás campos editables siguen editables (título, prioridad, habitación)", async () => {
    expect(await errorCodeAs(db, staffA, upd(`title = 'Grifo gotea mucho', priority = 'alta', room_number = '304'`))).toBeNull();
  });

  it("service_role (purgador) puede vaciar photo_path", async () => {
    expect(await errorCodeAs(db, SERVICE, upd(`photo_path = null`))).toBeNull();
  });

  it("INSERT: un parte nace abierto, sin datos de cierre (careo R3: fuga de email por closed_by ajeno)", async () => {
    const ins = `insert into public.maintenance_tickets (org_id, title, created_by, status, closed_by, closed_at) values ($1, 'x', $2, $3, $4, $5)`;
    const leak = await runAs(db, adminA, async (q) => {
      try {
        await q(ins, [ORG_A, adminA.userId, "cerrado", STAFF_B, new Date().toISOString()]);
      } catch {
        return [];
      }
      const r = await q<{ email: string }>(`select email from public.ticket_author_emails($1, $2::uuid[])`, [ORG_A, [STAFF_B]]);
      return r.rows.map((x) => x.email);
    });
    expect(leak).toEqual([]);
    expect(await errorCodeAs(db, adminA, ins, [ORG_A, adminA.userId, "cerrado", adminA.userId, "2020-01-01T00:00:00Z"])).toBe(DENIED);
    expect(await errorCodeAs(db, adminA, ins, [ORG_A, adminA.userId, "en_curso", null, null])).toBe(DENIED);
    expect(await errorCodeAs(db, adminA, ins, [ORG_A, adminA.userId, "abierto", adminA.userId, null])).toBe(DENIED);
    expect(await errorCodeAs(db, adminA, ins, [ORG_A, adminA.userId, "abierto", null, null])).toBeNull();
    // service_role (operador / seed) no pasa por la regla.
    expect(await errorCodeAs(db, SERVICE, ins, [ORG_A, adminA.userId, "cerrado", adminA.userId, "2020-01-01T00:00:00Z"])).toBeNull();
  });

  it("INSERT: photo_path solo puede ser {org_id del parte}/{uuid}.(jpg|png|webp)", async () => {
    const ins = `insert into public.maintenance_tickets (org_id, title, created_by, photo_path) values ($1, 'x', $2, $3)`;
    const uid = "0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    for (const bad of [`${ORG_B}/${uid}.jpg`, `${ORG_A}/../${ORG_B}/${uid}.jpg`, `${ORG_A}/${uid}.svg`, `${ORG_A}/foto.jpg`, `${ORG_A}/${uid}.jpg/x`]) {
      expect({ bad, code: await errorCodeAs(db, staffA, ins, [ORG_A, staffA.userId, bad]) }).toEqual({ bad, code: CHECK });
    }
    for (const ok of [`${ORG_A}/${uid}.jpg`, `${ORG_A}/${uid}.png`, `${ORG_A}/${uid}.webp`, null]) {
      expect({ ok, code: await errorCodeAs(db, staffA, ins, [ORG_A, staffA.userId, ok]) }).toEqual({ ok, code: null });
    }
  });

  it("000012 no aborta sobre datos antiguos no conformes: deja el CHECK sin validar pero lo aplica a lo nuevo (careo R2)", async () => {
    await db.query(`create database guard_legacy`);
    const legacy = await pg.connect({ database: "guard_legacy" });
    try {
      const { STUBS, applyFiles, migrationFiles } = await import("../harness/db");
      await applyFiles(legacy, STUBS);
      const files = migrationFiles();
      const before = files.filter((f) => !f.includes("/000012"));
      await applyFiles(legacy, before);
      await legacy.query(`insert into public.organizations (id, name, status) values ($1, 'L', 'active')`, [ORG_A]);
      await legacy.query(`insert into auth.users (id, email) values ($1, 'l@example.test')`, [staffA.userId]);
      await legacy.query(
        `insert into public.maintenance_tickets (org_id, title, created_by, photo_path, room_number) values ($1, 'viejo', $2, 'formato-viejo.JPG', ' 12 ')`,
        [ORG_A, staffA.userId],
      );
      await applyFiles(legacy, files.filter((f) => f.includes("/000012")));
      const { rows } = await legacy.query<{ conname: string; convalidated: boolean }>(
        `select conname, convalidated from pg_constraint where conname in ('maintenance_tickets_photo_path_org', 'maintenance_tickets_room_number_clean') order by 1`,
      );
      expect(rows).toEqual([
        { conname: "maintenance_tickets_photo_path_org", convalidated: false },
        { conname: "maintenance_tickets_room_number_clean", convalidated: false },
      ]);
      const bad = await legacy
        .query(`insert into public.maintenance_tickets (org_id, title, created_by, photo_path) values ($1, 'nuevo', $2, 'otra-vez.JPG')`, [ORG_A, staffA.userId])
        .then(() => null, (e: { code?: string }) => e.code);
      expect(bad).toBe(CHECK);
    } finally {
      await legacy.end();
    }
  });

  it("000012 valida los CHECK cuando los datos son conformes", async () => {
    const { rows } = await db.query<{ conname: string; convalidated: boolean }>(
      `select conname, convalidated from pg_constraint where conname in ('maintenance_tickets_photo_path_org', 'maintenance_tickets_room_number_clean') order by 1`,
    );
    expect(rows.every((r) => r.convalidated)).toBe(true);
  });

  it("room_number: rechaza vacío, espacios alrededor y caracteres de control", async () => {
    for (const bad of ["", "   ", " 304", "304 ", "30\n4", "30\t4"]) {
      expect({ bad, code: await errorCodeAs(db, staffA, `update public.maintenance_tickets set room_number = $1 where id = '${TICKET_A}'`, [bad]) }).toEqual({ bad, code: CHECK });
    }
    expect(await errorCodeAs(db, staffA, upd(`room_number = null`))).toBeNull();
    expect(await errorCodeAs(db, staffA, upd(`room_number = 'Planta 2 · pasillo'`))).toBeNull();
  });
});
