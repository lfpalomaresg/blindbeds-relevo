/**
 * Relevo atómico (supabase/migrations/000006_create_handover.sql) sobre
 * Postgres efímero.
 *
 * Antes: el formulario hacía dos inserts sueltos (shift_handovers y luego
 * handover_items). Si el segundo fallaba, quedaba una cabecera de relevo sin
 * items. Ahora `create_handover` inserta ambos en una sola llamada (una sola
 * transacción). Desde 000014 es security definer: comprueba la membresía activa
 * con get_user_org_ids() y la app ya no tiene INSERT directo en esas tablas.
 *
 * Las llamadas que deben dejar huella se hacen en AUTOCOMMIT (sin la
 * transacción revertida de `runAs`) y se mira el estado confirmado como
 * superusuario: es lo que vería la app tras un fallo real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { bootstrap } from "../harness/db";
import { gatePg, startEphemeralPostgres, type EphemeralPostgres } from "../harness/pg";
import { ANON, RLS_VIOLATION, asUser, errorCodeAs, type Actor } from "../harness/rls";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const staffA = asUser("aaaaaaaa-0000-0000-0000-00000000001a");

/** Marca para localizar (y limpiar) lo que crea este fichero. El fixture no usa 'fb'. */
const DEPT = "fb";
const CHECK_VIOLATION = "23514";
const INVALID_PARAM = "22023";

const CALL = `select public.create_handover($1, $2, $3, $4::jsonb) as id`;

const available = gatePg("create-handover.test");

describe.skipIf(!available)("create_handover: cabecera + items en una sola transacción (000006)", () => {
  let pg: EphemeralPostgres;
  let owner: Client;
  let session: Client;

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

  afterEach(async () => {
    await owner.query(`delete from public.shift_handovers where department = $1`, [DEPT]);
  });

  /** Ejecuta en autocommit con la identidad del actor (como una petición PostgREST). */
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

  async function committedCounts() {
    const h = await owner.query(`select count(*)::int as n from public.shift_handovers where department = $1`, [DEPT]);
    const i = await owner.query(
      `select count(*)::int as n from public.handover_items i join public.shift_handovers h on h.id = i.handover_id where h.department = $1`,
      [DEPT],
    );
    return { handovers: h.rows[0].n as number, items: i.rows[0].n as number };
  }

  it("crea el relevo y sus items, firmado por el usuario de la sesión y con el org_id del relevo", async () => {
    const items = [
      { block: "pendientes", content: "Revisar minibar 101" },
      { block: "avisos", content: "Grupo a las 16h" },
    ];
    const r = await autocommitAs(staffA, CALL, [ORG_A, DEPT, "noche", JSON.stringify(items)]);
    const id = r.rows[0].id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const h = await owner.query(`select org_id, department, shift_type, created_by from public.shift_handovers where id = $1`, [id]);
    expect(h.rows).toEqual([{ org_id: ORG_A, department: DEPT, shift_type: "noche", created_by: staffA.userId }]);
    const i = await owner.query(`select org_id, block, content from public.handover_items where handover_id = $1 order by block`, [id]);
    expect(i.rows).toEqual([
      { org_id: ORG_A, block: "avisos", content: "Grupo a las 16h" },
      { org_id: ORG_A, block: "pendientes", content: "Revisar minibar 101" },
    ]);
  });

  it("si un item es inválido no queda NADA: ni cabecera ni items (0 filas)", async () => {
    const items = [
      { block: "pendientes", content: "Válido" },
      { block: "inventado", content: "Bloque fuera de catálogo" },
    ];
    await expect(autocommitAs(staffA, CALL, [ORG_A, DEPT, "manana", JSON.stringify(items)])).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    });
    expect(await committedCounts()).toEqual({ handovers: 0, items: 0 });
  });

  it("un item con contenido vacío o sin contenido se rechaza y no deja nada", async () => {
    for (const bad of [{ block: "avisos", content: "   " }, { block: "avisos" }]) {
      const items = [{ block: "pendientes", content: "Válido" }, bad];
      await expect(autocommitAs(staffA, CALL, [ORG_A, DEPT, "tarde", JSON.stringify(items)])).rejects.toMatchObject({
        code: INVALID_PARAM,
      });
    }
    expect(await committedCounts()).toEqual({ handovers: 0, items: 0 });
  });

  it("sin items (o items que no son una lista) se rechaza: no hay relevos vacíos", async () => {
    for (const payload of ["[]", "{}", "null"]) {
      await expect(autocommitAs(staffA, CALL, [ORG_A, DEPT, "tarde", payload])).rejects.toMatchObject({
        code: INVALID_PARAM,
      });
    }
    expect(await committedCounts()).toEqual({ handovers: 0, items: 0 });
  });

  // 000017: los límites de la UI (validateHandoverInput) también en el servidor.
  // Una llamada directa a la RPC con la anon key + sesión no puede saltárselos.
  it("más de 4 ítems se rechaza (un relevo tiene 4 bloques) y no deja nada", async () => {
    // Cinco bloques distintos (el 5.º fuera de catálogo): sin la guarda de
    // cantidad el error sería el CHECK (23514), no 22023.
    const items = ["pendientes", "vips", "incidencias", "avisos", "otro_bloque"].map((block, n) => ({ block, content: `Ítem ${n}` }));
    await expect(autocommitAs(staffA, CALL, [ORG_A, DEPT, "noche", JSON.stringify(items)])).rejects.toMatchObject({
      code: INVALID_PARAM,
    });
    expect(await committedCounts()).toEqual({ handovers: 0, items: 0 });
  });

  it("dos ítems del mismo bloque se rechazan (un ítem por bloque) y no deja nada", async () => {
    const items = [
      { block: "pendientes", content: "Uno" },
      { block: "pendientes", content: "Otro" },
    ];
    await expect(autocommitAs(staffA, CALL, [ORG_A, DEPT, "noche", JSON.stringify(items)])).rejects.toMatchObject({
      code: INVALID_PARAM,
    });
    expect(await committedCounts()).toEqual({ handovers: 0, items: 0 });
  });

  it("un contenido de más de 2000 caracteres se rechaza; justo 2000 se acepta", async () => {
    const tooLong = [{ block: "avisos", content: "x".repeat(2001) }];
    await expect(autocommitAs(staffA, CALL, [ORG_A, DEPT, "noche", JSON.stringify(tooLong)])).rejects.toMatchObject({
      code: INVALID_PARAM,
    });
    expect(await committedCounts()).toEqual({ handovers: 0, items: 0 });

    const atLimit = [{ block: "avisos", content: "x".repeat(2000) }];
    await autocommitAs(staffA, CALL, [ORG_A, DEPT, "noche", JSON.stringify(atLimit)]);
    expect(await committedCounts()).toEqual({ handovers: 1, items: 1 });
  });

  it("el límite cuenta como la UI (String.length, unidades UTF-16): 1001 emojis = 2002 se rechaza, 1000 se acepta", async () => {
    const emoji = "\u{1F6BF}"; // fuera del BMP: 2 unidades UTF-16, 1 punto de código
    const tooLong = [{ block: "avisos", content: emoji.repeat(1001) }];
    await expect(autocommitAs(staffA, CALL, [ORG_A, DEPT, "noche", JSON.stringify(tooLong)])).rejects.toMatchObject({
      code: INVALID_PARAM,
    });
    expect(await committedCounts()).toEqual({ handovers: 0, items: 0 });

    const atLimit = [{ block: "avisos", content: emoji.repeat(1000) }];
    expect(atLimit[0].content.length).toBe(2000);
    await autocommitAs(staffA, CALL, [ORG_A, DEPT, "noche", JSON.stringify(atLimit)]);
    expect(await committedCounts()).toEqual({ handovers: 1, items: 1 });
  });

  it("cuatro textos enormes se rechazan sin dejar nada", async () => {
    // 4 ítems de 2 M de caracteres: si la RPC partiera cada texto en filas antes
    // de rechazarlo, serían 8 M de filas intermedias (CPU/memoria del servidor).
    const huge = "x".repeat(2_000_000);
    const items = ["pendientes", "vips", "incidencias", "avisos"].map((block) => ({ block, content: huge }));
    const payload = JSON.stringify(items);
    await expect(autocommitAs(staffA, CALL, [ORG_A, DEPT, "noche", payload])).rejects.toMatchObject({ code: INVALID_PARAM });
    expect(await committedCounts()).toEqual({ handovers: 0, items: 0 });
  }, 60_000);

  it("los 4 bloques distintos, uno por bloque, se aceptan", async () => {
    const items = ["pendientes", "vips", "incidencias", "avisos"].map((block) => ({ block, content: `Texto ${block}` }));
    await autocommitAs(staffA, CALL, [ORG_A, DEPT, "manana", JSON.stringify(items)]);
    expect(await committedCounts()).toEqual({ handovers: 1, items: 4 });
  });

  it("un miembro de A no puede crear un relevo en la org B (RLS) y no queda nada", async () => {
    const items = [{ block: "avisos", content: "Cruce de org" }];
    await expect(autocommitAs(staffA, CALL, [ORG_B, DEPT, "tarde", JSON.stringify(items)])).rejects.toMatchObject({
      code: RLS_VIOLATION,
    });
    expect(await committedCounts()).toEqual({ handovers: 0, items: 0 });
  });

  it("anon no puede ejecutarla", async () => {
    const items = JSON.stringify([{ block: "avisos", content: "x" }]);
    expect(await errorCodeAs(owner, ANON, CALL, [ORG_A, DEPT, "tarde", items])).toBe(RLS_VIOLATION);
  });

  it("el patrón antiguo (dos inserts sueltos) ya no es posible: 000014 quita la escritura directa", async () => {
    await expect(
      autocommitAs(
        staffA,
        `insert into public.shift_handovers (org_id, department, shift_type, created_by) values ($1, $2, 'noche', $3) returning id`,
        [ORG_A, DEPT, staffA.userId],
      ),
    ).rejects.toMatchObject({ code: RLS_VIOLATION });
    expect(await committedCounts()).toEqual({ handovers: 0, items: 0 });
  });
});
