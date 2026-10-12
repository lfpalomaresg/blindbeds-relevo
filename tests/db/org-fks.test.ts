/**
 * FK compuestas anti-cruce de organizaciones
 * (supabase/migrations/000004_org_scoped_fks.sql) sobre Postgres efímero.
 *
 * Antes: `handover_items.handover_id` y `maintenance_tickets.asset_id` solo
 * exigían que la fila referenciada existiera. Un miembro de A que adivinara un
 * UUID de B podía colgar un item de un relevo de B o un parte de un activo de
 * B: RLS mira el `org_id` de la fila nueva, no el de la fila referenciada.
 *
 * Ahora: `unique (id, org_id)` en el padre + FK `(parent_id, org_id)` en la
 * hija. El cruce se rechaza con 23503 (foreign_key_violation) para cualquier
 * rol, incluido service_role, que se salta RLS pero no las FK.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { join } from "node:path";
import { FIXTURE, ROOT, applyFiles, bootstrap, freshDatabase, migrationFile, migrationFiles } from "../harness/db";
import { gatePg, startEphemeralPostgres, type EphemeralPostgres } from "../harness/pg";
import { RLS_VIOLATION, asUser, errorCodeAs, runAs, type Actor } from "../harness/rls";

const FK_VIOLATION = "23503";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";

const staffA = asUser("aaaaaaaa-0000-0000-0000-00000000001a");
const adminA = asUser("aaaaaaaa-0000-0000-0000-00000000003a");
const staffB = asUser("bbbbbbbb-0000-0000-0000-00000000001b");
const serviceRole: Actor = { role: "service_role" };

const HANDOVER_A = "10000000-0000-0000-0000-00000000000a";
const HANDOVER_B = "10000000-0000-0000-0000-00000000000b";
const ITEM_A = "20000000-0000-0000-0000-00000000000a";
const ASSET_A = "30000000-0000-0000-0000-00000000000a";
const ASSET_B = "30000000-0000-0000-0000-00000000000b";
const TICKET_A = "40000000-0000-0000-0000-00000000000a";
const TICKET_B = "40000000-0000-0000-0000-00000000000b";

const INSERT_ITEM = `insert into public.handover_items (handover_id, org_id, block, content) values ($1, $2, 'avisos', 'test')`;
const INSERT_TICKET = `insert into public.maintenance_tickets (org_id, asset_id, title, created_by) values ($1, $2, 'Luz fundida', $3)`;
const INSERT_UPDATE = `insert into public.ticket_updates (ticket_id, status_from, status_to, created_by) values ($1, 'abierto', 'en_curso', $2)`;
const INSERT_UPDATE_ORG = `insert into public.ticket_updates (ticket_id, org_id, status_to, created_by) values ($1, $2, 'en_curso', $3)`;

const available = gatePg("org-fks.test");

describe.skipIf(!available)("FK compuestas por organización (000004_org_scoped_fks.sql)", () => {
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

  /** Ejecuta como superusuario dentro de una transacción que se revierte. */
  async function asOwner<T>(fn: () => Promise<T>): Promise<T> {
    await db.query("begin");
    try {
      return await fn();
    } finally {
      await db.query("rollback");
    }
  }

  async function ownerCode(text: string, values: unknown[] = []): Promise<string | null> {
    return asOwner(async () => {
      try {
        await db.query(text, values);
        return null;
      } catch (err) {
        return (err as { code?: string }).code ?? "unknown";
      }
    });
  }

  describe("esquema", () => {
    it.each([
      ["shift_handovers", "shift_handovers_id_org_id_key"],
      ["ticket_assets", "ticket_assets_id_org_id_key"],
      ["maintenance_tickets", "maintenance_tickets_id_org_id_key"],
    ])("%s tiene unique (id, org_id)", async (table, name) => {
      const r = await db.query(
        `select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = ($1)::regclass and conname = $2 and contype = 'u'`,
        [`public.${table}`, name],
      );
      expect(r.rows[0]?.def).toBe("UNIQUE (id, org_id)");
    });

    it.each([
      ["handover_items", "handover_items_handover_org_fkey", "FOREIGN KEY (handover_id, org_id) REFERENCES shift_handovers(id, org_id) ON DELETE CASCADE"],
      ["maintenance_tickets", "maintenance_tickets_asset_org_fkey", "FOREIGN KEY (asset_id, org_id) REFERENCES ticket_assets(id, org_id)"],
      ["ticket_updates", "ticket_updates_ticket_org_fkey", "FOREIGN KEY (ticket_id, org_id) REFERENCES maintenance_tickets(id, org_id) ON DELETE CASCADE"],
    ])("%s tiene la FK compuesta %s", async (table, name, def) => {
      const r = await db.query(
        `select pg_get_constraintdef(oid) as def, convalidated from pg_constraint where conrelid = ($1)::regclass and conname = $2 and contype = 'f'`,
        [`public.${table}`, name],
      );
      expect(r.rows[0]).toEqual({ def, convalidated: true });
    });

    it("las FK simples que permitían el cruce ya no existen (las sustituye la compuesta)", async () => {
      const r = await db.query(
        `select conname from pg_constraint where contype = 'f' and conname = any($1)`,
        [["handover_items_handover_id_fkey", "maintenance_tickets_asset_id_fkey", "ticket_updates_ticket_id_fkey"]],
      );
      expect(r.rows).toEqual([]);
    });

    it("ticket_updates.org_id existe, es NOT NULL y referencia organizations", async () => {
      const r = await db.query(
        `select is_nullable, data_type from information_schema.columns where table_schema = 'public' and table_name = 'ticket_updates' and column_name = 'org_id'`,
      );
      expect(r.rows[0]).toEqual({ is_nullable: "NO", data_type: "uuid" });
    });

    it("el fixture previo queda con ticket_updates.org_id = org del parte", async () => {
      const r = await db.query(
        `select count(*)::int as total, count(*) filter (where u.org_id = t.org_id)::int as ok
         from public.ticket_updates u join public.maintenance_tickets t on t.id = u.ticket_id`,
      );
      expect(r.rows[0]).toEqual({ total: 2, ok: 2 });
    });
  });

  describe("handover_items → shift_handovers", () => {
    it("camino normal: un miembro añade un item a un relevo de su org", async () => {
      expect(await errorCodeAs(db, staffA, INSERT_ITEM, [HANDOVER_A, ORG_A])).toBeNull();
    });

    it("CRUCE: miembro de A no puede colgar un item (org A) de un relevo de B → 23503", async () => {
      expect(await errorCodeAs(db, staffA, INSERT_ITEM, [HANDOVER_B, ORG_A])).toBe(FK_VIOLATION);
      expect(await errorCodeAs(db, adminA, INSERT_ITEM, [HANDOVER_B, ORG_A])).toBe(FK_VIOLATION);
    });

    it("CRUCE inverso: miembro de B no puede colgar un item (org B) de un relevo de A → 23503", async () => {
      expect(await errorCodeAs(db, staffB, INSERT_ITEM, [HANDOVER_A, ORG_B])).toBe(FK_VIOLATION);
    });

    it("CRUCE por update: no se puede reapuntar un item propio a un relevo de B → 23503", async () => {
      expect(await errorCodeAs(db, staffA, `update public.handover_items set handover_id = $1 where id = $2`, [HANDOVER_B, ITEM_A])).toBe(FK_VIOLATION);
    });

    it("etiquetar el item con la org ajena sigue cortándolo RLS (42501), como antes", async () => {
      expect(await errorCodeAs(db, staffA, INSERT_ITEM, [HANDOVER_B, ORG_B])).toBe(RLS_VIOLATION);
    });

    it("service_role se salta RLS pero NO la FK: el cruce también se rechaza en el servidor", async () => {
      expect(await errorCodeAs(db, serviceRole, INSERT_ITEM, [HANDOVER_B, ORG_A])).toBe(FK_VIOLATION);
      expect(await errorCodeAs(db, serviceRole, INSERT_ITEM, [HANDOVER_A, ORG_A])).toBeNull();
    });

    it("un relevo no puede cambiar de org dejando items atrás → 23503", async () => {
      expect(await ownerCode(`update public.shift_handovers set org_id = $1 where id = $2`, [ORG_B, HANDOVER_A])).toBe(FK_VIOLATION);
    });

    it("borrar un relevo sigue borrando sus items en cascada", async () => {
      const left = await asOwner(async () => {
        await db.query(`delete from public.shift_handovers where id = $1`, [HANDOVER_A]);
        const r = await db.query(`select count(*)::int as n from public.handover_items where handover_id = $1`, [HANDOVER_A]);
        return r.rows[0].n;
      });
      expect(left).toBe(0);
    });
  });

  describe("maintenance_tickets → ticket_assets", () => {
    it("camino normal: parte con un activo de la propia org", async () => {
      expect(await errorCodeAs(db, staffA, INSERT_TICKET, [ORG_A, ASSET_A, staffA.userId])).toBeNull();
    });

    it("camino normal: parte sin activo (asset_id nulo) sigue siendo válido", async () => {
      expect(await errorCodeAs(db, staffA, INSERT_TICKET, [ORG_A, null, staffA.userId])).toBeNull();
    });

    it("CRUCE: miembro de A no puede abrir un parte (org A) sobre un activo de B → 23503", async () => {
      expect(await errorCodeAs(db, staffA, INSERT_TICKET, [ORG_A, ASSET_B, staffA.userId])).toBe(FK_VIOLATION);
      expect(await errorCodeAs(db, adminA, INSERT_TICKET, [ORG_A, ASSET_B, adminA.userId])).toBe(FK_VIOLATION);
    });

    it("CRUCE por update: no se puede reapuntar un parte propio a un activo de B → 23503", async () => {
      expect(await errorCodeAs(db, staffA, `update public.maintenance_tickets set asset_id = $1 where id = $2`, [ASSET_B, TICKET_A])).toBe(FK_VIOLATION);
    });

    it("quitar el activo de un parte (asset_id = null) sigue permitido", async () => {
      expect(await errorCodeAs(db, staffA, `update public.maintenance_tickets set asset_id = null where id = $1`, [TICKET_A])).toBeNull();
    });

    it("un activo inexistente se rechaza igual que antes → 23503", async () => {
      expect(await errorCodeAs(db, staffA, INSERT_TICKET, [ORG_A, "30000000-0000-0000-0000-0000000000ff", staffA.userId])).toBe(FK_VIOLATION);
    });

    it("service_role tampoco puede cruzar parte y activo de orgs distintas", async () => {
      expect(await errorCodeAs(db, serviceRole, INSERT_TICKET, [ORG_A, ASSET_B, staffA.userId])).toBe(FK_VIOLATION);
    });

    it("un activo con partes no se borra ni cambia de org (restrict) → 23503", async () => {
      expect(await ownerCode(`delete from public.ticket_assets where id = $1`, [ASSET_A])).toBe(FK_VIOLATION);
      expect(await ownerCode(`update public.ticket_assets set org_id = $1 where id = $2`, [ORG_B, ASSET_A])).toBe(FK_VIOLATION);
    });
  });

  describe("ticket_updates → maintenance_tickets", () => {
    it("camino normal: la app no envía org_id y la fila hereda la org del parte", async () => {
      const org = await runAs(db, staffA, async (q) => {
        const r = await q<{ org_id: string }>(`${INSERT_UPDATE} returning org_id`, [TICKET_A, staffA.userId]);
        return r.rows[0].org_id;
      });
      expect(org).toBe(ORG_A);
    });

    it("enviar el org_id correcto también funciona", async () => {
      expect(await errorCodeAs(db, staffA, INSERT_UPDATE_ORG, [TICKET_A, ORG_A, staffA.userId])).toBeNull();
    });

    it("CRUCE: historial de un parte de A etiquetado con la org B → 23503", async () => {
      expect(await errorCodeAs(db, staffA, INSERT_UPDATE_ORG, [TICKET_A, ORG_B, staffA.userId])).toBe(FK_VIOLATION);
      expect(await errorCodeAs(db, serviceRole, INSERT_UPDATE_ORG, [TICKET_A, ORG_B, staffA.userId])).toBe(FK_VIOLATION);
    });

    it("registrar un cambio en un parte de otra org sigue cortándolo RLS (42501), no un NOT NULL", async () => {
      expect(await errorCodeAs(db, staffA, INSERT_UPDATE, [TICKET_B, staffA.userId])).toBe(RLS_VIOLATION);
      expect(await errorCodeAs(db, staffA, INSERT_UPDATE_ORG, [TICKET_B, ORG_A, staffA.userId])).toBe(RLS_VIOLATION);
      expect(await errorCodeAs(db, staffA, INSERT_UPDATE_ORG, [TICKET_B, ORG_B, staffA.userId])).toBe(RLS_VIOLATION);
    });

    it("service_role sin org_id también hereda la org del parte", async () => {
      const org = await runAs(db, serviceRole, async (q) => {
        const r = await q<{ org_id: string }>(`${INSERT_UPDATE} returning org_id`, [TICKET_B, staffB.userId]);
        return r.rows[0].org_id;
      });
      expect(org).toBe(ORG_B);
    });

    it("borrar un parte sigue borrando su historial en cascada", async () => {
      const left = await asOwner(async () => {
        await db.query(`delete from public.maintenance_tickets where id = $1`, [TICKET_A]);
        const r = await db.query(`select count(*)::int as n from public.ticket_updates where ticket_id = $1`, [TICKET_A]);
        return r.rows[0].n;
      });
      expect(left).toBe(0);
    });

    it("un parte con historial no puede cambiar de org → 23503", async () => {
      expect(await ownerCode(`update public.maintenance_tickets set org_id = $1, asset_id = null where id = $2`, [ORG_B, TICKET_A])).toBe(FK_VIOLATION);
    });
  });

  describe("la migración sobre bases con datos", () => {
    const baseline = () => readFileSync(migrationFile("000001_"), "utf8");
    const migration = () => readFileSync(migrationFile("000004_"), "utf8");

    it("es idempotente: aplicarla dos veces no falla ni duplica constraints o triggers", async () => {
      const other = await freshDatabase(pg, db, "fk_idempotent");
      try {
        await other.query(baseline());
        await other.query(readFileSync(FIXTURE, "utf8"));
        await other.query(migration());
        await other.query(migration());
        const c = await other.query(
          `select count(*)::int as n from pg_constraint where connamespace = 'public'::regnamespace and (conname like '%_id_org_id_key' or conname like '%_org_fkey')`,
        );
        expect(c.rows[0].n).toBe(6);
        const t = await other.query(`select count(*)::int as n from pg_trigger where tgrelid = 'public.ticket_updates'::regclass and not tgisinternal`);
        expect(t.rows[0].n).toBe(1);
      } finally {
        await other.end();
      }
    });

    it("una constraint homónima pero incorrecta (deriva) no engaña a la migración: queda la FK canónica", async () => {
      const other = await freshDatabase(pg, db, "fk_drift");
      try {
        await other.query(baseline());
        await other.query(readFileSync(FIXTURE, "utf8"));
        await other.query(`alter table public.handover_items add constraint handover_items_handover_org_fkey check (true)`);
        await other.query(`alter table public.shift_handovers add constraint shift_handovers_id_org_id_key check (true)`);
        await other.query(migration());
        const r = await other.query(
          `select conname, contype::text as contype from pg_constraint
           where conname in ('handover_items_handover_org_fkey', 'shift_handovers_id_org_id_key') order by conname`,
        );
        expect(r.rows).toEqual([
          { conname: "handover_items_handover_org_fkey", contype: "f" },
          { conname: "shift_handovers_id_org_id_key", contype: "u" },
        ]);
        await expect(
          other.query(`insert into public.handover_items (handover_id, org_id, block, content) values ($1, $2, 'avisos', 'cruce')`, [HANDOVER_B, ORG_A]),
        ).rejects.toMatchObject({ code: FK_VIOLATION });
      } finally {
        await other.end();
      }
    });

    it("scripts/seed-demo.sql se carga tras todas las migraciones (lo que hace el script de setup) y es repetible", async () => {
      const other = await freshDatabase(pg, db, "fk_seed");
      try {
        await applyFiles(other, migrationFiles());
        const seed = readFileSync(join(ROOT, "scripts/seed-demo.sql"), "utf8");
        await other.query(seed);
        await other.query(seed);
        const r = await other.query(`select count(*)::int as n from public.ticket_assets`);
        expect(r.rows[0].n).toBeGreaterThan(0);
      } finally {
        await other.end();
      }
    });

    it("con datos previos coherentes rellena ticket_updates.org_id desde el parte", async () => {
      const other = await freshDatabase(pg, db, "fk_backfill");
      try {
        await other.query(baseline());
        await other.query(readFileSync(FIXTURE, "utf8"));
        await other.query(migration());
        const r = await other.query<{ ticket_id: string; org_id: string }>(`select ticket_id, org_id from public.ticket_updates order by ticket_id`);
        expect(r.rows).toEqual([
          { ticket_id: TICKET_A, org_id: ORG_A },
          { ticket_id: TICKET_B, org_id: ORG_B },
        ]);
      } finally {
        await other.end();
      }
    });

    it.each([
      [
        "un item de la org A colgado de un relevo de B",
        `insert into public.handover_items (handover_id, org_id, block, content) values ('${HANDOVER_B}', '${ORG_A}', 'avisos', 'cruzado')`,
        /1 handover_items/,
      ],
      [
        "un parte de la org A sobre un activo de B",
        `insert into public.maintenance_tickets (org_id, asset_id, title, created_by) values ('${ORG_A}', '${ASSET_B}', 'cruzado', '${staffA.userId}')`,
        /1 maintenance_tickets/,
      ],
    ])("si ya existe %s, la migración ABORTA con un mensaje claro y no deja nada a medias", async (_label, dirty, detail) => {
      const other = await freshDatabase(pg, db, `fk_dirty_${detail.source.includes("items") ? "items" : "tickets"}`);
      try {
        await other.query(baseline());
        await other.query(readFileSync(FIXTURE, "utf8"));
        await other.query(dirty); // el baseline lo permite: ese es el agujero
        await expect(other.query(migration())).rejects.toThrow(/cross-organization references/i);
        await expect(other.query(migration())).rejects.toThrow(detail);
        // Nada aplicado a medias: ni la columna nueva ni las constraints.
        const col = await other.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ticket_updates' and column_name = 'org_id'`);
        expect(col.rowCount).toBe(0);
        const con = await other.query(`select 1 from pg_constraint where conname like '%_id_org_id_key' or conname like '%_org_fkey'`);
        expect(con.rowCount).toBe(0);
      } finally {
        await other.end();
      }
    });
  });
});
