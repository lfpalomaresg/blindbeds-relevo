/**
 * Matriz RLS sobre un Postgres efímero real (sin Docker).
 *
 * Aplica tests/harness/supabase-stub.sql (auth/storage/roles mínimos) y la
 * migración supabase/migrations/000001_baseline.sql, carga un fixture
 * sintético y comprueba las policies para staff / supervisor / admin, para
 * un usuario sin membership, para un miembro de una org suspendida y para anon,
 * en las 5 tablas de Relevo (+ organizations y memberships, que las sostienen).
 *
 * Si no hay binarios de Postgres el fichero se omite con aviso en local; en CI
 * (`CI=true`) o con RLS_REQUIRE_PG=1 la ausencia es un FALLO (ver `gatePg`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import { gatePg, startEphemeralPostgres, type EphemeralPostgres } from "../harness/pg";
import { ANON, RLS_VIOLATION, asUser, countAs, errorCodeAs, rowCountAs, runAs } from "../harness/rls";

const ROOT = resolve(__dirname, "../..");
const STUB = resolve(ROOT, "tests/harness/supabase-stub.sql");
const FIXTURE = resolve(ROOT, "tests/harness/fixture.sql");
const BASELINE = resolve(ROOT, "supabase/migrations/000001_baseline.sql");
const VARIANT_000002 = resolve(ROOT, "supabase/variants/shared-appcc/000002_relevo_tables.sql");

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const ORG_C = "00000000-0000-0000-0000-00000000000c";

const staffA = asUser("aaaaaaaa-0000-0000-0000-00000000001a");
const supervisorA = asUser("aaaaaaaa-0000-0000-0000-00000000002a");
const adminA = asUser("aaaaaaaa-0000-0000-0000-00000000003a");
const staffB = asUser("bbbbbbbb-0000-0000-0000-00000000001b");
const adminC = asUser("cccccccc-0000-0000-0000-00000000001c");
const outsider = asUser("99999999-0000-0000-0000-000000000099");

const HANDOVER_A = "10000000-0000-0000-0000-00000000000a";
const HANDOVER_B = "10000000-0000-0000-0000-00000000000b";
const ITEM_A = "20000000-0000-0000-0000-00000000000a";
const ITEM_B = "20000000-0000-0000-0000-00000000000b";
const ASSET_A = "30000000-0000-0000-0000-00000000000a";
const ASSET_B = "30000000-0000-0000-0000-00000000000b";
const TICKET_A = "40000000-0000-0000-0000-00000000000a";
const TICKET_B = "40000000-0000-0000-0000-00000000000b";

const RELEVO_TABLES = ["shift_handovers", "handover_items", "ticket_assets", "maintenance_tickets", "ticket_updates"] as const;
const ALL_TABLES = ["organizations", "memberships", ...RELEVO_TABLES] as const;

// En CI (o con RLS_REQUIRE_PG=1) lanza si no hay Postgres: el fichero falla, no se omite.
const available = gatePg("rls.test");

describe.skipIf(!available)("RLS sobre Postgres efímero (000001_baseline.sql)", () => {
  let pg: EphemeralPostgres;
  let db: Client;
  let migrationError: unknown = null;

  beforeAll(async () => {
    pg = await startEphemeralPostgres();
    await pg.applySqlFile(STUB);
    try {
      await pg.applySqlFile(BASELINE);
      await pg.applySqlFile(FIXTURE);
    } catch (err) {
      migrationError = err;
    }
    db = await pg.connect();
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    await pg?.stop();
  });

  describe("migración", () => {
    it("000001_baseline.sql se aplica sin errores sobre un Postgres limpio", () => {
      expect(migrationError, String((migrationError as Error)?.message)).toBeNull();
    });

    it.each(ALL_TABLES)("RLS está activo en public.%s", async (table) => {
      const r = await db.query<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class where oid = ($1)::regclass",
        [`public.${table}`],
      );
      expect(r.rows[0]?.relrowsecurity).toBe(true);
    });

    it("la variante 000002 NO es secuencial: tras el baseline falla con duplicate_table (42P07)", async () => {
      // Base de datos aparte para no tocar la que usan el resto de tests.
      await db.query("create database variant_check");
      const other = await pg.connect({ database: "variant_check" });
      try {
        await other.query(readFileSync(STUB, "utf8"));
        await other.query(readFileSync(BASELINE, "utf8"));
        await expect(other.query(readFileSync(VARIANT_000002, "utf8"))).rejects.toMatchObject({ code: "42P07" });
      } finally {
        await other.end();
      }
    });

    it("el bucket privado ticket-photos queda declarado con límite de 10 MB", async () => {
      const r = await db.query(
        "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'ticket-photos'",
      );
      expect(r.rows[0]).toMatchObject({
        public: false,
        file_size_limit: "10485760",
        allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
      });
    });
  });

  describe("has_org_role: jerarquía staff < supervisor < admin", () => {
    const check = (actor: ReturnType<typeof asUser>, min: string) =>
      runAs(db, actor, async (q) => {
        const r = await q<{ ok: boolean }>("select public.has_org_role($1, $2) as ok", [ORG_A, min]);
        return r.rows[0].ok;
      });

    it("staff cumple 'staff' pero no 'supervisor' ni 'admin'", async () => {
      expect(await check(staffA, "staff")).toBe(true);
      expect(await check(staffA, "supervisor")).toBe(false);
      expect(await check(staffA, "admin")).toBe(false);
    });

    it("supervisor cumple 'staff' y 'supervisor' pero NO 'admin'", async () => {
      expect(await check(supervisorA, "staff")).toBe(true);
      expect(await check(supervisorA, "supervisor")).toBe(true);
      expect(await check(supervisorA, "admin")).toBe(false);
    });

    it("admin cumple los tres niveles", async () => {
      expect(await check(adminA, "staff")).toBe(true);
      expect(await check(adminA, "supervisor")).toBe(true);
      expect(await check(adminA, "admin")).toBe(true);
    });

    it("un usuario de otra org no cumple ningún nivel en org A", async () => {
      expect(await check(staffB, "staff")).toBe(false);
    });

    it("un min_role desconocido nunca se cumple (fallo cerrado), ni para admin", async () => {
      expect(await check(adminA, "owner")).toBe(false);
      expect(await check(adminA, "")).toBe(false);
    });
  });

  describe("aislamiento por organización (select)", () => {
    for (const actor of [
      ["staff", staffA],
      ["supervisor", supervisorA],
      ["admin", adminA],
    ] as const) {
      it.each(RELEVO_TABLES)(`${actor[0]} de org A solo ve filas de org A en %s`, async (table) => {
        const where = table === "ticket_updates"
          ? `ticket_id in (select id from public.maintenance_tickets)`
          : "true";
        expect(await countAs(db, actor[1], table, where)).toBe(1);
        if (table !== "ticket_updates") {
          expect(await countAs(db, actor[1], table, `org_id = '${ORG_B}'`)).toBe(0);
        }
      });
    }

    it("staff de org B ve exactamente su ticket_update, no el de org A", async () => {
      expect(await countAs(db, staffB, "ticket_updates", `ticket_id = '${TICKET_B}'`)).toBe(1);
      expect(await countAs(db, staffB, "ticket_updates", `ticket_id = '${TICKET_A}'`)).toBe(0);
    });

    it.each(ALL_TABLES)("anon no ve nada en %s", async (table) => {
      expect(await countAs(db, ANON, table)).toBe(0);
    });

    it.each(ALL_TABLES)("usuario autenticado sin membership no ve nada en %s", async (table) => {
      expect(await countAs(db, outsider, table)).toBe(0);
    });

    it("miembro de una organización suspendida no ve ni su propia organización", async () => {
      expect(await countAs(db, adminC, "organizations")).toBe(0);
      expect(await countAs(db, adminC, "memberships")).toBe(0);
    });

    it("cada miembro ve solo su organización y las memberships de su org", async () => {
      expect(await countAs(db, staffA, "organizations")).toBe(1);
      expect(await countAs(db, staffA, "organizations", `id = '${ORG_A}'`)).toBe(1);
      expect(await countAs(db, staffA, "memberships")).toBe(3);
      expect(await countAs(db, staffB, "memberships")).toBe(1);
    });
  });

  describe("shift_handovers", () => {
    const insert = `insert into public.shift_handovers (org_id, department, shift_type, created_by) values ($1, 'recepcion', 'noche', $2)`;

    it("staff crea un handover en su org firmado por sí mismo", async () => {
      expect(await errorCodeAs(db, staffA, insert, [ORG_A, staffA.userId])).toBeNull();
    });

    it("staff no puede firmar el handover como otro usuario", async () => {
      expect(await errorCodeAs(db, staffA, insert, [ORG_A, adminA.userId])).toBe(RLS_VIOLATION);
    });

    it("staff no puede crear handovers en otra org", async () => {
      expect(await errorCodeAs(db, staffA, insert, [ORG_B, staffA.userId])).toBe(RLS_VIOLATION);
    });

    it("anon y usuarios sin membership no pueden insertar", async () => {
      expect(await errorCodeAs(db, ANON, insert, [ORG_A, staffA.userId])).toBe(RLS_VIOLATION);
      expect(await errorCodeAs(db, outsider, insert, [ORG_A, outsider.userId])).toBe(RLS_VIOLATION);
    });

    it("nadie puede actualizar ni borrar handovers (no hay policy): 0 filas afectadas", async () => {
      for (const actor of [staffA, supervisorA, adminA]) {
        expect(await rowCountAs(db, actor, `update public.shift_handovers set read_by = $1 where id = $2`, [actor.userId, HANDOVER_A])).toBe(0);
        expect(await rowCountAs(db, actor, `delete from public.shift_handovers where id = $1`, [HANDOVER_A])).toBe(0);
      }
    });
  });

  describe("handover_items", () => {
    const insert = `insert into public.handover_items (handover_id, org_id, block, content) values ($1, $2, 'avisos', 'test')`;

    it("cualquier miembro inserta items en su org", async () => {
      for (const actor of [staffA, supervisorA, adminA]) {
        expect(await errorCodeAs(db, actor, insert, [HANDOVER_A, ORG_A])).toBeNull();
      }
    });

    it("no se pueden insertar items etiquetados con otra org", async () => {
      expect(await errorCodeAs(db, staffA, insert, [HANDOVER_B, ORG_B])).toBe(RLS_VIOLATION);
      expect(await errorCodeAs(db, outsider, insert, [HANDOVER_A, ORG_A])).toBe(RLS_VIOLATION);
    });

    it("staff resuelve items de su org", async () => {
      expect(await rowCountAs(db, staffA, `update public.handover_items set resolved = true, resolved_by = $1 where id = $2`, [staffA.userId, ITEM_A])).toBe(1);
    });

    it("staff no puede resolver items de otra org (RLS los oculta)", async () => {
      expect(await rowCountAs(db, staffA, `update public.handover_items set resolved = true where id = $1`, [ITEM_B])).toBe(0);
    });

    it("no se puede mover un item a otra org vía update", async () => {
      expect(await errorCodeAs(db, adminA, `update public.handover_items set org_id = $1 where id = $2`, [ORG_B, ITEM_A])).toBe(RLS_VIOLATION);
    });

    it("nadie borra items (sin policy de delete)", async () => {
      expect(await rowCountAs(db, adminA, `delete from public.handover_items where id = $1`, [ITEM_A])).toBe(0);
    });
  });

  describe("ticket_assets: lectura para todos, gestión solo admin", () => {
    const insert = `insert into public.ticket_assets (org_id, name, qr_code) values ($1, 'Nuevo activo', $2)`;

    it("admin crea activos en su org", async () => {
      expect(await errorCodeAs(db, adminA, insert, [ORG_A, "TEST-NEW-1"])).toBeNull();
    });

    it("staff NO puede crear activos", async () => {
      expect(await errorCodeAs(db, staffA, insert, [ORG_A, "TEST-NEW-2"])).toBe(RLS_VIOLATION);
    });

    it("supervisor NO puede crear activos", async () => {
      expect(await errorCodeAs(db, supervisorA, insert, [ORG_A, "TEST-NEW-3"])).toBe(RLS_VIOLATION);
    });

    it("admin de org A no puede crear activos en org B", async () => {
      expect(await errorCodeAs(db, adminA, insert, [ORG_B, "TEST-NEW-4"])).toBe(RLS_VIOLATION);
    });

    it("solo admin actualiza y borra activos de su org", async () => {
      const update = `update public.ticket_assets set location = 'Planta 2' where id = $1`;
      expect(await rowCountAs(db, staffA, update, [ASSET_A])).toBe(0);
      expect(await rowCountAs(db, supervisorA, update, [ASSET_A])).toBe(0);
      expect(await rowCountAs(db, adminA, update, [ASSET_A])).toBe(1);
      expect(await rowCountAs(db, adminA, update, [ASSET_B])).toBe(0);
      expect(await rowCountAs(db, adminA, `delete from public.ticket_assets where id = $1`, [ASSET_B])).toBe(0);
    });

    it("staff y supervisor no borran activos de su org (0 filas); admin borra uno sin partes asociados", async () => {
      // ASSET_A tiene un parte que lo referencia (FK restrict): si RLS no filtrara, el error sería 23503, no 0 filas.
      for (const actor of [staffA, supervisorA]) {
        expect(await rowCountAs(db, actor, `delete from public.ticket_assets where id = $1`, [ASSET_A])).toBe(0);
      }
      const deleted = await runAs(db, adminA, async (q) => {
        await q(insert, [ORG_A, "TEST-NEW-DEL"]);
        const r = await q(`delete from public.ticket_assets where org_id = $1 and qr_code = 'TEST-NEW-DEL'`, [ORG_A]);
        return r.rowCount ?? 0;
      });
      expect(deleted).toBe(1);
    });
  });

  describe("maintenance_tickets", () => {
    const insert = `insert into public.maintenance_tickets (org_id, title, created_by) values ($1, 'Luz fundida', $2)`;

    it("cualquier miembro abre partes en su org firmados por sí mismo", async () => {
      for (const actor of [staffA, supervisorA, adminA]) {
        expect(await errorCodeAs(db, actor, insert, [ORG_A, actor.userId])).toBeNull();
      }
    });

    it("no se puede abrir un parte a nombre de otro ni en otra org", async () => {
      expect(await errorCodeAs(db, staffA, insert, [ORG_A, supervisorA.userId])).toBe(RLS_VIOLATION);
      expect(await errorCodeAs(db, staffA, insert, [ORG_B, staffA.userId])).toBe(RLS_VIOLATION);
      expect(await errorCodeAs(db, outsider, insert, [ORG_A, outsider.userId])).toBe(RLS_VIOLATION);
    });

    it("cualquier miembro cambia el estado de partes de su org, no de otras", async () => {
      const update = `update public.maintenance_tickets set status = 'en_curso' where id = $1`;
      expect(await rowCountAs(db, staffA, update, [TICKET_A])).toBe(1);
      expect(await rowCountAs(db, staffA, update, [TICKET_B])).toBe(0);
      expect(await rowCountAs(db, staffB, update, [TICKET_A])).toBe(0);
    });

    it("no se puede mover un parte a otra org vía update (with check)", async () => {
      expect(await errorCodeAs(db, adminA, `update public.maintenance_tickets set org_id = $1 where id = $2`, [ORG_B, TICKET_A])).toBe(RLS_VIOLATION);
    });

    it("el check de estado rechaza valores fuera del catálogo", async () => {
      expect(await errorCodeAs(db, staffA, `update public.maintenance_tickets set status = 'perdido' where id = $1`, [TICKET_A])).toBe("23514");
    });

    it("nadie borra partes (sin policy de delete)", async () => {
      expect(await rowCountAs(db, adminA, `delete from public.maintenance_tickets where id = $1`, [TICKET_A])).toBe(0);
    });
  });

  describe("ticket_updates", () => {
    const insert = `insert into public.ticket_updates (ticket_id, status_from, status_to, created_by) values ($1, 'abierto', 'en_curso', $2)`;

    it("miembro registra un cambio en un parte de su org", async () => {
      expect(await errorCodeAs(db, staffA, insert, [TICKET_A, staffA.userId])).toBeNull();
    });

    it("no se puede registrar un cambio en un parte de otra org", async () => {
      expect(await errorCodeAs(db, staffA, insert, [TICKET_B, staffA.userId])).toBe(RLS_VIOLATION);
    });

    it("no se puede firmar el cambio como otro usuario", async () => {
      expect(await errorCodeAs(db, staffA, insert, [TICKET_A, adminA.userId])).toBe(RLS_VIOLATION);
    });

    it("el historial es inmutable: update y delete afectan 0 filas", async () => {
      expect(await rowCountAs(db, adminA, `update public.ticket_updates set comment = 'x' where ticket_id = $1`, [TICKET_A])).toBe(0);
      expect(await rowCountAs(db, adminA, `delete from public.ticket_updates where ticket_id = $1`, [TICKET_A])).toBe(0);
    });
  });

  describe("memberships: solo admin gestiona", () => {
    const insert = `insert into public.memberships (org_id, user_id, role) values ($1, $2, 'staff')`;

    it("admin añade miembros a su org", async () => {
      expect(await errorCodeAs(db, adminA, insert, [ORG_A, outsider.userId])).toBeNull();
    });

    it("supervisor y staff no pueden añadir miembros", async () => {
      expect(await errorCodeAs(db, supervisorA, insert, [ORG_A, outsider.userId])).toBe(RLS_VIOLATION);
      expect(await errorCodeAs(db, staffA, insert, [ORG_A, outsider.userId])).toBe(RLS_VIOLATION);
    });

    it("admin no puede añadir miembros a otra org ni auto-invitarse a ella", async () => {
      expect(await errorCodeAs(db, adminA, insert, [ORG_B, outsider.userId])).toBe(RLS_VIOLATION);
      expect(await errorCodeAs(db, adminA, insert, [ORG_B, adminA.userId])).toBe(RLS_VIOLATION);
    });

    it("admin elimina a otros pero no a sí mismo; supervisor no elimina a nadie", async () => {
      const del = `delete from public.memberships where org_id = $1 and user_id = $2`;
      expect(await rowCountAs(db, adminA, del, [ORG_A, staffA.userId])).toBe(1);
      expect(await rowCountAs(db, adminA, del, [ORG_A, adminA.userId])).toBe(0);
      expect(await rowCountAs(db, supervisorA, del, [ORG_A, staffA.userId])).toBe(0);
    });

    it("nadie cambia roles vía update (sin policy)", async () => {
      expect(await rowCountAs(db, adminA, `update public.memberships set role = 'admin' where user_id = $1`, [staffA.userId])).toBe(0);
      expect(await rowCountAs(db, staffA, `update public.memberships set role = 'admin' where user_id = $1`, [staffA.userId])).toBe(0);
    });
  });

  describe("organizations", () => {
    it("ningún miembro, ni admin, puede crear, modificar o borrar organizaciones", async () => {
      expect(await errorCodeAs(db, adminA, `insert into public.organizations (name) values ('Hotel Pirata')`)).toBe(RLS_VIOLATION);
      expect(await rowCountAs(db, adminA, `update public.organizations set name = 'x' where id = $1`, [ORG_A])).toBe(0);
      expect(await rowCountAs(db, adminA, `delete from public.organizations where id = $1`, [ORG_A])).toBe(0);
      expect(await rowCountAs(db, adminC, `update public.organizations set status = 'active' where id = $1`, [ORG_C])).toBe(0);
    });
  });
});
