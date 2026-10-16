/**
 * Matriz de policies de `storage.objects` para el bucket `ticket-photos`
 * (supabase/migrations/000003_storage_policies.sql) sobre Postgres efímero.
 *
 * El esquema `storage` es un STUB de tests (tests/harness/storage-stub.sql):
 * tiene RLS activo y los mismos GRANT que Supabase, así que cada «denegado»
 * lo decide una policy. Esto prueba el SQL de las policies, no la API de
 * Storage: la verificación definitiva es contra un Supabase real (runbook §6).
 *
 * Reglas probadas (rol × operación × org propia / ajena / suspendida):
 *   - leer:   miembro activo de la org del prefijo `<org_id>/…`
 *   - subir:  igual que abrir un parte (cualquier miembro activo), solo a
 *             `<org_id>/<fichero>` (un nivel)
 *   - borrar: solo admin de esa org
 *   - mover / sobrescribir: nadie
 *   - anon, usuarios sin membership y orgs suspendidas: nada
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { bootstrap, freshDatabase, migrationFile } from "../harness/db";
import { gatePg, startEphemeralPostgres, type EphemeralPostgres } from "../harness/pg";
import { ANON, RLS_VIOLATION, asUser, runAs, type Actor } from "../harness/rls";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const ORG_C = "00000000-0000-0000-0000-00000000000c"; // suspendida

const staffA = asUser("aaaaaaaa-0000-0000-0000-00000000001a");
const supervisorA = asUser("aaaaaaaa-0000-0000-0000-00000000002a");
const adminA = asUser("aaaaaaaa-0000-0000-0000-00000000003a");
const staffB = asUser("bbbbbbbb-0000-0000-0000-00000000001b");
const adminC = asUser("cccccccc-0000-0000-0000-00000000001c");
const outsider = asUser("99999999-0000-0000-0000-000000000099");
const serviceRole: Actor = { role: "service_role" };

const BUCKET = "ticket-photos";
const OTHER_BUCKET = "other-bucket";
const existing = (org: string) => `${org}/existing.jpg`;
const fresh = (org: string) => `${org}/5b0c8a52-8f5e-4f7e-9a51-3d2f3f2b7c11.jpg`;

const ORGS = [
  ["A (activa)", ORG_A],
  ["B (activa)", ORG_B],
  ["C (suspendida)", ORG_C],
] as const;

const ACTORS: ReadonlyArray<readonly [string, Actor, { member: string | null; admin: boolean }]> = [
  ["staff de A", staffA, { member: ORG_A, admin: false }],
  ["supervisor de A", supervisorA, { member: ORG_A, admin: false }],
  ["admin de A", adminA, { member: ORG_A, admin: true }],
  ["staff de B", staffB, { member: ORG_B, admin: false }],
  // Miembro (admin) de una org suspendida: no tiene ninguna org activa.
  ["admin de C (suspendida)", adminC, { member: null, admin: false }],
  ["usuario sin membership", outsider, { member: null, admin: false }],
  ["anon", ANON, { member: null, admin: false }],
];

/** actor × org → casos de la matriz. */
const MATRIX = ACTORS.flatMap(([actorName, actor, who]) =>
  ORGS.map(([orgName, org]) => ({
    actorName,
    actor,
    orgName,
    org,
    isMember: who.member === org,
    isAdmin: who.member === org && who.admin,
  })),
);

const INSERT = `insert into storage.objects (bucket_id, name, owner, owner_id) values ($1, $2, auth.uid(), auth.uid()::text)`;

const available = gatePg("storage.test");

describe.skipIf(!available)("storage.objects · bucket ticket-photos (000003_storage_policies.sql)", () => {
  let pg: EphemeralPostgres;
  let db: Client;

  async function visible(actor: Actor, bucket: string, name: string): Promise<number> {
    return runAs(db, actor, async (q) => {
      const r = await q(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, name]);
      return r.rowCount ?? 0;
    });
  }

  async function code(actor: Actor, text: string, values: unknown[]): Promise<string | null> {
    return runAs(db, actor, async (q) => {
      try {
        await q(text, values);
        return null;
      } catch (err) {
        return (err as { code?: string }).code ?? "unknown";
      }
    });
  }

  async function affected(actor: Actor, text: string, values: unknown[]): Promise<number> {
    return runAs(db, actor, async (q) => (await q(text, values)).rowCount ?? 0);
  }

  beforeAll(async () => {
    pg = await startEphemeralPostgres();
    await bootstrap(pg);
    db = await pg.connect();
    // Objetos preexistentes, creados como superusuario (fuera de RLS).
    await db.query(`insert into storage.buckets (id, name, public) values ($1, $1, false) on conflict do nothing`, [OTHER_BUCKET]);
    for (const [, org] of ORGS) {
      await db.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [BUCKET, existing(org)]);
    }
    await db.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [OTHER_BUCKET, existing(ORG_A)]);
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    await pg?.stop();
  });

  describe("migración", () => {
    it("crea exactamente las policies de ticket-photos sobre storage.objects, todas solo para authenticated", async () => {
      const r = await db.query<{ policyname: string; cmd: string; roles: string }>(
        `select policyname, cmd, roles::text as roles from pg_policies
         where schemaname = 'storage' and tablename = 'objects' order by policyname`,
      );
      expect(r.rows).toEqual([
        { policyname: "ticket_photos_delete_admin", cmd: "DELETE", roles: "{authenticated}" },
        { policyname: "ticket_photos_insert_member", cmd: "INSERT", roles: "{authenticated}" },
        { policyname: "ticket_photos_select_member", cmd: "SELECT", roles: "{authenticated}" },
      ]);
    });

    it("no toca la propiedad ni el RLS de storage.objects (en Supabase la tabla no es nuestra)", () => {
      const sql = readMigration().toLowerCase().replace(/--.*$/gm, "");
      expect(sql).not.toMatch(/alter\s+table\s+storage\./);
      expect(sql).not.toMatch(/create\s+table/);
      expect(sql).not.toMatch(/grant\s/);
    });

    it("es idempotente: aplicarla dos veces seguidas no falla ni duplica policies", async () => {
      const other = await freshDatabase(pg, db, "storage_idempotent");
      try {
        await other.query(readFileSync(migrationFile("000001_"), "utf8"));
        const sql = readFileSync(migrationFile("000003_"), "utf8");
        await other.query(sql);
        await other.query(sql);
        const r = await other.query(`select count(*)::int as n from pg_policies where schemaname = 'storage' and tablename = 'objects'`);
        expect(r.rows[0].n).toBe(3);
      } finally {
        await other.end();
      }
    });

    it("el stub de storage tiene RLS activo en objects: sin policy nadie pasa (control del harness)", async () => {
      const r = await db.query(`select relrowsecurity from pg_class where oid = 'storage.objects'::regclass`);
      expect(r.rows[0].relrowsecurity).toBe(true);
    });
  });

  describe("leer (select): solo miembros activos de la org del prefijo", () => {
    it.each(MATRIX)("$actorName → foto de org $orgName: visible=$isMember", async ({ actor, org, isMember }) => {
      expect(await visible(actor, BUCKET, existing(org))).toBe(isMember ? 1 : 0);
    });

    it("un miembro solo lista los objetos de su org, no el bucket entero", async () => {
      const names = await runAs(db, staffA, async (q) => {
        const r = await q<{ name: string }>(`select name from storage.objects order by name`);
        return r.rows.map((row) => row.name);
      });
      expect(names).toEqual([existing(ORG_A)]);
    });
  });

  describe("subir (insert): quien puede abrir partes en esa org", () => {
    it.each(MATRIX)("$actorName → sube a org $orgName: permitido=$isMember", async ({ actor, org, isMember }) => {
      expect(await code(actor, INSERT, [BUCKET, fresh(org)])).toBe(isMember ? null : RLS_VIOLATION);
    });

    it("la subida devuelve la fila (insert … returning), como hace la API de Storage", async () => {
      const name = await runAs(db, staffA, async (q) => {
        const r = await q<{ name: string }>(`${INSERT} returning name`, [BUCKET, fresh(ORG_A)]);
        return r.rows[0]?.name;
      });
      expect(name).toBe(fresh(ORG_A));
    });

    it.each([
      ["en la raíz del bucket (sin carpeta de org)", "suelto.jpg"],
      ["con una subcarpeta bajo la org", `${ORG_A}/sub/foto.jpg`],
      ["con prefijo que no es un UUID", "no-es-uuid/foto.jpg"],
      ["con la org como sufijo de otra carpeta", `x${ORG_A}/foto.jpg`],
      ["con la org en mayúsculas", `${ORG_A.toUpperCase()}/foto.jpg`],
      ["con la org en el segundo segmento", `${ORG_B}/${ORG_A}/foto.jpg`],
      ["con '..' para escapar a otra org", `${ORG_A}/../${ORG_B}/foto.jpg`],
      ["con nombre de fichero vacío", `${ORG_A}/`],
      ["con barra inicial", `/${ORG_A}/foto.jpg`],
    ])("un miembro de A NO puede subir %s (42501, nunca un error de cast)", async (_label, name) => {
      expect(await code(staffA, INSERT, [BUCKET, name])).toBe(RLS_VIOLATION);
      expect(await code(adminA, INSERT, [BUCKET, name])).toBe(RLS_VIOLATION);
    });

    it("con nombre nulo se deniega", async () => {
      expect(await code(staffA, INSERT, [BUCKET, null])).toBe(RLS_VIOLATION);
    });

    it("las policies no abren otros buckets: mismo prefijo de org en otro bucket, denegado", async () => {
      expect(await code(adminA, INSERT, [OTHER_BUCKET, fresh(ORG_A)])).toBe(RLS_VIOLATION);
      expect(await visible(adminA, OTHER_BUCKET, existing(ORG_A))).toBe(0);
      expect(await affected(adminA, `delete from storage.objects where bucket_id = $1 and name = $2`, [OTHER_BUCKET, existing(ORG_A)])).toBe(0);
    });
  });

  describe("borrar (delete): solo admin de la org", () => {
    const del = `delete from storage.objects where bucket_id = $1 and name = $2`;

    it.each(MATRIX)("$actorName → borra foto de org $orgName: permitido=$isAdmin", async ({ actor, org, isAdmin }) => {
      expect(await affected(actor, del, [BUCKET, existing(org)])).toBe(isAdmin ? 1 : 0);
    });

    it("quien sube una foto no puede borrarla si no es admin (ni siquiera la suya)", async () => {
      const deleted = await runAs(db, staffA, async (q) => {
        await q(INSERT, [BUCKET, fresh(ORG_A)]);
        return (await q(del, [BUCKET, fresh(ORG_A)])).rowCount ?? 0;
      });
      expect(deleted).toBe(0);
    });
  });

  describe("mover / sobrescribir (update): nadie", () => {
    it.each(MATRIX)("$actorName → no modifica la foto de org $orgName", async ({ actor, org }) => {
      expect(await affected(actor, `update storage.objects set metadata = '{}'::jsonb where bucket_id = $1 and name = $2`, [BUCKET, existing(org)])).toBe(0);
    });

    it("ni el admin puede mover una foto de su org a otra org ni a otro bucket", async () => {
      expect(await affected(adminA, `update storage.objects set name = $3 where bucket_id = $1 and name = $2`, [BUCKET, existing(ORG_A), fresh(ORG_B)])).toBe(0);
      expect(await affected(adminA, `update storage.objects set bucket_id = $3 where bucket_id = $1 and name = $2`, [BUCKET, existing(ORG_A), OTHER_BUCKET])).toBe(0);
    });
  });

  describe("buckets y service_role", () => {
    it("los clientes no ven ni crean buckets (RLS sin policies, como en Supabase)", async () => {
      for (const actor of [staffA, adminA, ANON]) {
        const n = await runAs(db, actor, async (q) => (await q(`select 1 from storage.buckets`)).rowCount ?? 0);
        expect(n).toBe(0);
        expect(await code(actor, `insert into storage.buckets (id, name) values ($1, $1)`, ["pirata"])).toBe(RLS_VIOLATION);
      }
    });

    it("service_role (servidor) no está limitado por las policies", async () => {
      expect(await visible(serviceRole, BUCKET, existing(ORG_C))).toBe(1);
      expect(await code(serviceRole, INSERT, [BUCKET, fresh(ORG_C)])).toBeNull();
    });
  });

  function readMigration(): string {
    return readFileSync(migrationFile("000003_"), "utf8");
  }
});
