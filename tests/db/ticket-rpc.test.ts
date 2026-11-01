/**
 * Partes de avería SOLO por RPC (supabase/migrations/000013_ticket_rpc.sql).
 *
 * Rediseño tras 3 rondas de careo (01/11/2026): cada ronda encontró un hueco
 * nuevo en la misma superficie — la app escribía `maintenance_tickets` y
 * `ticket_updates` directamente con policies amplias. Ahora:
 *  - anon/authenticated NO tienen INSERT/UPDATE/DELETE en esas dos tablas;
 *  - se crea con `create_ticket()` (fija created_by, status 'abierto', sin cierre)
 *    y se cambia con `change_ticket_status()`; ambas comprueban la membresía;
 *  - el trigger de 000012 queda como segunda barrera (ver ticket-guard.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { STUBS, applyFiles, bootstrap, migrationFile, migrationFiles } from "../harness/db";
import { gatePg, startEphemeralPostgres, type EphemeralPostgres } from "../harness/pg";
import { ANON, asUser, errorCodeAs, runAs } from "../harness/rls";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const ORG_C_SUSPENDED = "00000000-0000-0000-0000-00000000000c";
const staffA = asUser("aaaaaaaa-0000-0000-0000-00000000001a");
const adminA = asUser("aaaaaaaa-0000-0000-0000-00000000003a");
const staffB = asUser("bbbbbbbb-0000-0000-0000-00000000001b");
const adminC = asUser("cccccccc-0000-0000-0000-00000000001c");
const outsider = asUser("99999999-0000-0000-0000-000000000099");
const STAFF_B = "bbbbbbbb-0000-0000-0000-00000000001b";
const ASSET_A = "30000000-0000-0000-0000-00000000000a";
const ASSET_B = "30000000-0000-0000-0000-00000000000b";
const TICKET_A = "40000000-0000-0000-0000-00000000000a";
const FILE = "0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const DENIED = "42501";
const CHECK = "23514";
const FK = "23503";
const INVALID = "22023";

const CREATE = `select public.create_ticket($1, $2, $3, $4, $5, $6, $7) as id`;
/** Simula la subida a Storage: Supabase rellena owner_id con el usuario del JWT. Se hace como propietario. */
const UPLOAD = `insert into storage.objects (bucket_id, name, owner_id, created_at) values ('ticket-photos', $1, $2, now() - $3::interval)`;
const args = (over: Partial<{ org: string; title: string; description: string | null; priority: string; asset: string | null; room: string | null; photo: string | null }> = {}) => {
  const a = { org: ORG_A, title: "Grifo gotea", description: null, priority: "normal", asset: null, room: "304", photo: null, ...over };
  return [a.org, a.title, a.description, a.priority, a.asset, a.room, a.photo];
};

const available = gatePg("ticket-rpc.test");

describe.skipIf(!available)("partes solo por RPC (000013_ticket_rpc.sql)", () => {
  let pg: EphemeralPostgres;
  let db: Client;

  beforeAll(async () => {
    pg = await startEphemeralPostgres();
    await bootstrap(pg);
    db = await pg.connect();
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    await pg?.stop();
  });

  it("la app no puede escribir maintenance_tickets ni ticket_updates directamente", async () => {
    const stmts: [string, unknown[]][] = [
      [`insert into public.maintenance_tickets (org_id, title, created_by) values ($1, 'x', $2)`, [ORG_A, adminA.userId]],
      [`update public.maintenance_tickets set title = 'x' where id = $1`, [TICKET_A]],
      [`delete from public.maintenance_tickets where id = $1`, [TICKET_A]],
      [`insert into public.ticket_updates (ticket_id, status_from, status_to, created_by) values ($1, 'abierto', 'en_curso', $2)`, [TICKET_A, adminA.userId]],
    ];
    for (const [sql, values] of stmts) {
      for (const actor of [adminA, staffA, ANON]) {
        expect({ sql, role: actor.role, code: await errorCodeAs(db, actor, sql, values) }).toEqual({ sql, role: actor.role, code: DENIED });
      }
    }
  });

  it("create_ticket: un miembro crea un parte en su org, abierto, firmado por él y sin cierre", async () => {
    const row = await runAs(db, staffA, async (q) => {
      await q(UPLOAD, [`${ORG_A}/${FILE}.jpg`, staffA.userId, "0 hours"]);
      const { rows } = await q<{ id: string }>(CREATE, args({ asset: ASSET_A, photo: `${ORG_A}/${FILE}.jpg`, description: "Gotea" }));
      const t = await q(`select org_id, title, description, priority, asset_id, room_number, photo_path, status, created_by, closed_by, closed_at from public.maintenance_tickets where id = $1`, [rows[0].id]);
      return t.rows[0];
    });
    expect(row).toEqual({
      org_id: ORG_A, title: "Grifo gotea", description: "Gotea", priority: "normal", asset_id: ASSET_A, room_number: "304",
      photo_path: `${ORG_A}/${FILE}.jpg`, status: "abierto", created_by: staffA.userId, closed_by: null, closed_at: null,
    });
  });

  it("create_ticket: no en otra org, ni en una org suspendida, ni sin membresía, ni anon", async () => {
    expect(await errorCodeAs(db, staffA, CREATE, args({ org: ORG_B }))).toBe(DENIED);
    expect(await errorCodeAs(db, adminC, CREATE, args({ org: ORG_C_SUSPENDED }))).toBe(DENIED);
    expect(await errorCodeAs(db, outsider, CREATE, args())).toBe(DENIED);
    expect(await errorCodeAs(db, ANON, CREATE, args())).toBe(DENIED);
  });

  it("create_ticket: valida título, descripción, prioridad, activo, habitación y foto", async () => {
    expect(await errorCodeAs(db, staffA, CREATE, args({ title: "   " }))).toBe(INVALID);
    expect(await errorCodeAs(db, staffA, CREATE, args({ title: "x".repeat(121) }))).toBe(INVALID);
    expect(await errorCodeAs(db, staffA, CREATE, args({ description: "x".repeat(2001) }))).toBe(INVALID);
    expect(await errorCodeAs(db, staffA, CREATE, args({ priority: "urgentisima" }))).toBe(CHECK);
    expect(await errorCodeAs(db, staffA, CREATE, args({ asset: ASSET_B }))).toBe(FK);
    expect(await errorCodeAs(db, staffA, CREATE, args({ room: " 304" }))).toBe(CHECK);
    // Foto de otra org: la rechaza ya la comprobación de propiedad (el CHECK de ruta,
    // en ticket-guard.test.ts).
    expect(await errorCodeAs(db, staffA, CREATE, args({ photo: `${ORG_B}/${FILE}.jpg` }))).toBe(DENIED);
  });

  it("create_ticket: la foto tiene que existir, ser de quien crea el parte y reciente (< 12 h) — careo RPC R1", async () => {
    const photo = (n: number) => `${ORG_A}/0b1e2c3d-4e5f-4a6b-8c7d-${String(n).padStart(12, "0")}.jpg`;
    const codes = await runAs(db, staffA, async (q) => {
      // runAs ejecuta como authenticated; la «subida» la hace el propietario.
      await q("reset role");
      await q(UPLOAD, [photo(1), adminA.userId, "0 hours"]); // la subió otro
      await q(UPLOAD, [photo(2), staffA.userId, "13 hours"]); // demasiado antigua
      await q(UPLOAD, [photo(3), staffA.userId, "0 hours"]); // válida
      await q("set local role authenticated");
      const out: (string | null)[] = [];
      for (const ph of [photo(9) /* no existe */, photo(1), photo(2), photo(3), photo(3) /* reutilizada */]) {
        await q("savepoint s");
        try {
          await q(CREATE, args({ photo: ph }));
          out.push(null);
          await q("release savepoint s");
        } catch (e) {
          out.push((e as { code?: string }).code ?? "unknown");
          await q("rollback to savepoint s");
        }
      }
      return out;
    });
    expect(codes).toEqual([DENIED, DENIED, DENIED, null, "23505"]);
  });

  it("una misma foto no puede estar en dos partes (índice único) — careo RPC R1", async () => {
    const { rows } = await db.query<{ ok: boolean }>(
      `select indisunique as ok from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = 'maintenance_tickets_photo_path_key'`,
    );
    expect(rows).toEqual([{ ok: true }]);
  });

  it("no hay forma de que la app ponga el closed_by/created_by de un usuario de otra org (fuga de emails)", async () => {
    const leaked = await runAs(db, adminA, async (q) => {
      for (const sql of [
        `update public.maintenance_tickets set closed_by = '${STAFF_B}' where id = '${TICKET_A}'`,
        `insert into public.maintenance_tickets (org_id, title, created_by, status, closed_by, closed_at) values ('${ORG_A}', 'x', '${adminA.userId}', 'cerrado', '${STAFF_B}', now())`,
      ]) {
        await q("savepoint s");
        await q(sql).catch(() => undefined);
        await q("rollback to savepoint s");
      }
      const r = await q<{ email: string }>(`select email from public.ticket_author_emails($1, $2::uuid[])`, [ORG_A, [STAFF_B]]);
      return r.rows;
    });
    expect(leaked).toEqual([]);
  });

  it("change_ticket_status sigue funcionando para miembros y no toca partes de otra org", async () => {
    const out = await runAs(db, staffA, async (q) => {
      const a = (await q<{ ok: boolean }>(`select public.change_ticket_status($1, 'abierto', 'cerrado') as ok`, [TICKET_A])).rows[0].ok;
      const t = (await q(`select status, closed_by from public.maintenance_tickets where id = $1`, [TICKET_A])).rows[0];
      const h = (await q(`select status_from, status_to, created_by from public.ticket_updates where ticket_id = $1 and status_from is not null`, [TICKET_A])).rows;
      return { a, t, h };
    });
    expect(out).toEqual({
      a: true,
      t: { status: "cerrado", closed_by: staffA.userId },
      h: [{ status_from: "abierto", status_to: "cerrado", created_by: staffA.userId }],
    });
    expect(await runAs(db, staffB, async (q) => (await q<{ ok: boolean }>(`select public.change_ticket_status($1, 'abierto', 'cerrado') as ok`, [TICKET_A])).rows[0].ok)).toBe(false);
  });

  it("tras un `grant all` manual, reaplicar 000011 + 000013 vuelve a quitar la escritura directa", async () => {
    await admin_drift_db();
    async function admin_drift_db() {
      await db.query(`create database rpc_drift`);
      const d = await pg.connect({ database: "rpc_drift" });
      try {
        await applyFiles(d, STUBS);
        await applyFiles(d, migrationFiles());
        await d.query(`grant all on all tables in schema public to anon, authenticated, service_role`);
        await applyFiles(d, [migrationFile("000011"), migrationFile("000013")]);
        const { rows } = await d.query<{ t: string; ok: boolean }>(
          `select t, has_table_privilege('authenticated', t, 'INSERT, UPDATE, DELETE') as ok
             from unnest(array['public.maintenance_tickets', 'public.ticket_updates']) as t`,
        );
        expect(rows).toEqual([
          { t: "public.maintenance_tickets", ok: false },
          { t: "public.ticket_updates", ok: false },
        ]);
      } finally {
        await d.end();
      }
    }
  });
});

describe.skipIf(!available)("pendientes del relevo solo por RPC (000014_handover_item_rpc.sql) — careo RPC R1", () => {
  let pg: EphemeralPostgres;
  let db: Client;
  const ITEM_A = "20000000-0000-0000-0000-00000000000a";
  const ITEM_B = "20000000-0000-0000-0000-00000000000b";
  const RESOLVE = `select public.resolve_handover_item($1) as ok`;

  beforeAll(async () => {
    pg = await startEphemeralPostgres();
    await bootstrap(pg);
    db = await pg.connect();
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    await pg?.stop();
  });

  it("la app no inserta relevos ni items directamente (solo create_handover) — careo RPC R2", async () => {
    const HANDOVER_A = "10000000-0000-0000-0000-00000000000a";
    for (const actor of [staffA, adminA]) {
      expect(await errorCodeAs(db, actor, `insert into public.shift_handovers (org_id, department, shift_type, created_by) values ($1, 'recepcion', 'noche', $2)`, [ORG_A, actor.userId])).toBe(DENIED);
      expect(
        await errorCodeAs(db, actor, `insert into public.handover_items (handover_id, org_id, block, content, resolved, resolved_by, resolved_at) values ($1, $2, 'avisos', 'falso', true, $3, now() - interval '3 days')`, [HANDOVER_A, ORG_A, STAFF_B]),
      ).toBe(DENIED);
    }
  });

  it("create_handover sigue creando relevo + items (no resueltos) firmados por quien llama", async () => {
    const out = await runAs(db, staffA, async (q) => {
      const id = (await q<{ id: string }>(`select public.create_handover($1, 'recepcion', 'noche', $2::jsonb) as id`, [ORG_A, JSON.stringify([{ block: "avisos", content: "Grupo a las 16h", resolved: true }])])).rows[0].id;
      const h = (await q(`select created_by from public.shift_handovers where id = $1`, [id])).rows[0];
      const items = (await q(`select content, resolved, resolved_by from public.handover_items where handover_id = $1`, [id])).rows;
      return { h, items };
    });
    expect(out).toEqual({ h: { created_by: staffA.userId }, items: [{ content: "Grupo a las 16h", resolved: false, resolved_by: null }] });
    expect(await errorCodeAs(db, staffA, `select public.create_handover($1, 'recepcion', 'noche', $2::jsonb)`, [ORG_B, JSON.stringify([{ block: "avisos", content: "x" }])])).toBe(DENIED);
    expect(await errorCodeAs(db, adminC, `select public.create_handover($1, 'recepcion', 'noche', $2::jsonb)`, [ORG_C_SUSPENDED, JSON.stringify([{ block: "avisos", content: "x" }])])).toBe(DENIED);
  });

  it("la app no actualiza handover_items directamente", async () => {
    for (const actor of [staffA, adminA]) {
      expect(await errorCodeAs(db, actor, `update public.handover_items set content = 'x' where id = $1`, [ITEM_A])).toBe(DENIED);
      expect(await errorCodeAs(db, actor, `update public.handover_items set resolved = true, resolved_by = $1 where id = $2`, [STAFF_B, ITEM_A])).toBe(DENIED);
    }
  });

  it("resolve_handover_item firma quién y cuándo, una sola vez, y no toca otra org", async () => {
    const out = await runAs(db, staffA, async (q) => {
      const first = (await q<{ ok: boolean }>(RESOLVE, [ITEM_A])).rows[0].ok;
      const again = (await q<{ ok: boolean }>(RESOLVE, [ITEM_A])).rows[0].ok;
      const other = (await q<{ ok: boolean }>(RESOLVE, [ITEM_B])).rows[0].ok;
      const row = (await q(`select resolved, resolved_by, resolved_at is not null as has_at, content from public.handover_items where id = $1`, [ITEM_A])).rows[0];
      return { first, again, other, row };
    });
    expect(out).toEqual({
      first: true, again: false, other: false,
      row: { resolved: true, resolved_by: staffA.userId, has_at: true, content: "Revisar minibar 101" },
    });
    expect(await runAs(db, staffB, async (q) => (await q(`select resolved from public.handover_items where id = $1`, [ITEM_B])).rows[0].resolved)).toBe(false);
  });

  it("anon no puede usarla", async () => {
    expect(await errorCodeAs(db, ANON, RESOLVE, [ITEM_A])).toBe(DENIED);
  });
});
