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
const supervisorA = asUser("aaaaaaaa-0000-0000-0000-00000000002a");
const adminA = asUser("aaaaaaaa-0000-0000-0000-00000000003a");

/** Marca para localizar (y limpiar) lo que crea este fichero. El fixture no usa 'fb'. */
const DEPT = "fb";
const CHECK_VIOLATION = "23514";
const INVALID_PARAM = "22023";

const CALL_LEGACY = `select public.create_handover($1, $2, $3, $4::jsonb) as id`;
// La app usa la versión idempotente; los tests de validación/límites/RLS la ejercitan con clave null.
const CALL = `select public.create_handover_idempotent($1, $2, $3, $4::jsonb, null::uuid) as id`;
const CALL_IDEM = `select public.create_handover_idempotent($1, $2, $3, $4::jsonb, $5::uuid) as id`;

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

  // 000021: idempotencia (doble clic / reintento tras respuesta perdida).
  it("misma clave de idempotencia: no duplica (mismo id, un relevo, items una vez)", async () => {
    const items = [{ block: "pendientes", content: "Uno" }];
    const clave = "11111111-1111-4111-8111-111111111111";
    const a = await autocommitAs(staffA, CALL_IDEM, [ORG_A, DEPT, "noche", JSON.stringify(items), clave]);
    const b = await autocommitAs(staffA, CALL_IDEM, [ORG_A, DEPT, "noche", JSON.stringify(items), clave]);
    expect(b.rows[0].id).toBe(a.rows[0].id);
    expect(await committedCounts()).toEqual({ handovers: 1, items: 1 });
  });

  it("claves distintas: dos relevos distintos", async () => {
    const items = [{ block: "pendientes", content: "Uno" }];
    const a = await autocommitAs(staffA, CALL_IDEM, [ORG_A, DEPT, "noche", JSON.stringify(items), "22222222-2222-4222-8222-222222222222"]);
    const b = await autocommitAs(staffA, CALL_IDEM, [ORG_A, DEPT, "noche", JSON.stringify(items), "33333333-3333-4333-8333-333333333333"]);
    expect(b.rows[0].id).not.toBe(a.rows[0].id);
    expect(await committedCounts()).toEqual({ handovers: 2, items: 2 });
  });

  it("misma clave con petición distinta: se rechaza y no altera nada", async () => {
    const clave = "44444444-4444-4444-8444-444444444444";
    const uno = JSON.stringify([{ block: "pendientes", content: "Uno" }]);
    const dos = JSON.stringify([{ block: "pendientes", content: "Dos" }]);
    const a = await autocommitAs(staffA, CALL_IDEM, [ORG_A, DEPT, "noche", uno, clave]);
    // Contenido distinto con la misma clave: no puede devolver el anterior en silencio.
    await expect(autocommitAs(staffA, CALL_IDEM, [ORG_A, DEPT, "noche", dos, clave])).rejects.toMatchObject({
      code: "22000",
    });
    // Turno distinto con la misma clave: idem.
    await expect(autocommitAs(staffA, CALL_IDEM, [ORG_A, DEPT, "tarde", uno, clave])).rejects.toMatchObject({
      code: "22000",
    });
    expect(a.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await committedCounts()).toEqual({ handovers: 1, items: 1 });
  });

  it("otro miembro del mismo hotel reutilizando la clave: rechazo, sin filtrar id ni alterar datos", async () => {
    const clave = "66666666-6666-4666-8666-666666666666";
    const items = JSON.stringify([{ block: "pendientes", content: "Uno" }]);
    await autocommitAs(staffA, CALL_IDEM, [ORG_A, DEPT, "noche", items, clave]);
    let mensaje = "";
    try {
      await autocommitAs(supervisorA, CALL_IDEM, [ORG_A, DEPT, "noche", items, clave]);
    } catch (error) {
      mensaje = String((error as { message?: string }).message ?? "");
    }
    expect(mensaje).toMatch(/different request/i);
    // el mensaje no incluye el id del relevo existente
    const { rows } = await owner.query(`select id from public.shift_handovers where department = $1`, [DEPT]);
    expect(rows).toHaveLength(1);
    expect(mensaje).not.toContain(rows[0].id);
    expect(await committedCounts()).toEqual({ handovers: 1, items: 1 });
  });

  it("el contenido no queda en la cabecera ni tras borrar el item (solo la huella)", async () => {
    const secreto = "Contenido sensible 9174";
    const items = JSON.stringify([{ block: "pendientes", content: secreto }]);
    const r = await autocommitAs(staffA, CALL_IDEM, [ORG_A, DEPT, "noche", items, "77777777-7777-4777-8777-777777777777"]);
    const id = r.rows[0].id as string;
    const item = await owner.query(`select id from public.handover_items where handover_id = $1`, [id]);
    await autocommitAs(adminA, `select public.delete_handover_item($1) as ok`, [item.rows[0].id]);
    const left = await owner.query(`select count(*)::int as n from public.handover_items where handover_id = $1`, [id]);
    expect(left.rows[0].n).toBe(0);
    const cab = await owner.query(`select row_to_json(h)::text as j from public.shift_handovers h where id = $1`, [id]);
    expect(cab.rows[0].j).not.toContain(secreto);
    const del = await owner.query(`select row_to_json(d)::text as j from public.handover_item_deletions d where handover_id = $1`, [id]);
    expect(del.rows).toHaveLength(1);  // la huella de auditoría existe (si no, el test de abajo sería vacío)
    expect(del.rows[0].j).not.toContain(secreto);
  });

  it("la versión antigua de 4 args (000017) sigue disponible (compatibilidad)", async () => {
    const items = JSON.stringify([{ block: "pendientes", content: "Legacy" }]);
    const r = await autocommitAs(staffA, CALL_LEGACY, [ORG_A, DEPT, "noche", items]);
    expect(r.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await committedCounts()).toEqual({ handovers: 1, items: 1 });
  });

  it("carrera: dos peticiones simultáneas con la misma clave devuelven el mismo id (un relevo)", async () => {
    const clave = "55555555-5555-4555-8555-555555555555";
    const items = JSON.stringify([{ block: "pendientes", content: "Carrera" }]);
    const claims = JSON.stringify({ sub: staffA.userId, role: staffA.role });
    const c2 = await pg.connect();
    try {
      const pid = (await c2.query("select pg_backend_pid() as pid")).rows[0].pid as number;
      for (const c of [session, c2]) {
        await c.query("select set_config('request.jwt.claims', $1, false)", [claims]);
        await c.query("select set_config('request.jwt.claim.sub', $1, false)", [staffA.userId ?? ""]);
        await c.query(`set role ${staffA.role}`);
      }
      await session.query("BEGIN");
      const a = await session.query(CALL_IDEM, [ORG_A, DEPT, "noche", items, clave]);
      // c2 llega al INSERT mientras la fila de `session` sigue sin confirmar: espera al índice único.
      const bPromise = c2.query(CALL_IDEM, [ORG_A, DEPT, "noche", items, clave]);
      // Barrera: espera a que la segunda sesión esté REALMENTE bloqueada en el índice único.
      let bloqueada = false;
      for (let i = 0; i < 100 && !bloqueada; i++) {
        const { rows } = await owner.query(
          `select count(*)::int as n from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'`,
          [pid],
        );
        bloqueada = rows[0].n > 0;
        if (!bloqueada) await new Promise((r) => setTimeout(r, 20));
      }
      expect(bloqueada).toBe(true);
      await session.query("COMMIT");
      const b = await bPromise;
      expect(b.rows[0].id).toBe(a.rows[0].id);
      expect(await committedCounts()).toEqual({ handovers: 1, items: 1 });
    } finally {
      await session.query("ROLLBACK").catch(() => {});
      await session.query("reset role").catch(() => {});
      await c2.end().catch(() => {});
    }
  });

  it("sin clave (null) en la versión idempotente: cada llamada crea un relevo", async () => {
    const items = [{ block: "pendientes", content: "Uno" }];
    await autocommitAs(staffA, CALL, [ORG_A, DEPT, "noche", JSON.stringify(items)]);
    await autocommitAs(staffA, CALL, [ORG_A, DEPT, "noche", JSON.stringify(items)]);
    expect(await committedCounts()).toEqual({ handovers: 2, items: 2 });
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
