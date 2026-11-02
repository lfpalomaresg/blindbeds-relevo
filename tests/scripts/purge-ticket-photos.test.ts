import { describe, expect, it } from "vitest";
import { fetchClosedWithPhoto, findOrphans, purgeExpired, selectExpiredPhotos, sweepOrphans } from "../../scripts/purge-ticket-photos.mjs";

const NOW = new Date("2026-11-01T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const ORG = "00000000-0000-0000-0000-00000000000a";
const OTHER = "00000000-0000-0000-0000-00000000000b";
const FILE = "0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const row = (over: Partial<{ id: string; org_id: string; photo_path: string | null; status: string; closed_at: string | null }>) => ({
  id: "t",
  org_id: ORG,
  photo_path: `${ORG}/${FILE}.png`,
  status: "cerrado",
  closed_at: daysAgo(100),
  ...over,
});

describe("selectExpiredPhotos", () => {
  it("selecciona fotos de partes cerrados hace más de 90 días", () => {
    const out = selectExpiredPhotos([row({ id: "a" })], NOW, 90);
    expect(out.map((r) => r.id)).toEqual(["a"]);
  });

  it("deja los cerrados dentro del plazo", () => {
    expect(selectExpiredPhotos([row({ closed_at: daysAgo(89) })], NOW, 90)).toHaveLength(0);
    expect(selectExpiredPhotos([row({ closed_at: daysAgo(90) })], NOW, 90)).toHaveLength(0);
  });

  it("no toca partes abiertos ni en curso aunque tengan foto antigua", () => {
    expect(selectExpiredPhotos([row({ status: "abierto" })], NOW, 90)).toHaveLength(0);
    expect(selectExpiredPhotos([row({ status: "en_curso" })], NOW, 90)).toHaveLength(0);
  });

  it("ignora partes sin foto y sin closed_at o con fecha inválida", () => {
    expect(selectExpiredPhotos([row({ photo_path: null })], NOW, 90)).toHaveLength(0);
    expect(selectExpiredPhotos([row({ closed_at: null })], NOW, 90)).toHaveLength(0);
    expect(selectExpiredPhotos([row({ closed_at: "no-es-fecha" })], NOW, 90)).toHaveLength(0);
  });

  it("respeta el número de días recibido", () => {
    expect(selectExpiredPhotos([row({ closed_at: daysAgo(31) })], NOW, 30)).toHaveLength(1);
    expect(selectExpiredPhotos([row({ closed_at: daysAgo(31) })], NOW, 60)).toHaveLength(0);
  });
});

describe("selectExpiredPhotos — la ruta tiene que ser de la org del parte (careo 01/11)", () => {
  it("descarta rutas de otra org, con ../ o con otro formato", () => {
    for (const photo_path of [`${OTHER}/${FILE}.png`, `${ORG}/../${OTHER}/${FILE}.png`, `${ORG}/foto.png`, `${ORG}/${FILE}.svg`, `${ORG}/${FILE}.png/x`]) {
      expect({ photo_path, n: selectExpiredPhotos([row({ photo_path })], NOW, 90).length }).toEqual({ photo_path, n: 0 });
    }
  });

  it("descarta filas sin org_id", () => {
    expect(selectExpiredPhotos([row({ org_id: undefined as unknown as string })], NOW, 90)).toHaveLength(0);
  });
});

describe("fetchClosedWithPhoto — pagina hasta agotar (careo 01/11)", () => {
  it("pide páginas ordenadas por id y para cuando una viene incompleta", async () => {
    const all = Array.from({ length: 5 }, (_, i) => ({ id: `id-${i}` }));
    const urls: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get("offset"));
      const limit = Number(new URL(url).searchParams.get("limit"));
      return new Response(JSON.stringify(all.slice(offset, offset + limit)), { status: 200 });
    }) as typeof fetch;
    const rows = await fetchClosedWithPhoto("https://x.supabase.co", {}, "2026-08-03T00:00:00.000Z", fakeFetch, 2);
    expect(rows.map((r: { id: string }) => r.id)).toEqual(all.map((r) => r.id));
    expect(urls).toHaveLength(3);
    for (const u of urls) {
      expect(u).toContain("order=id.asc");
      expect(u).toContain("closed_at=lt.2026-08-03T00%3A00%3A00.000Z");
      expect(u).toContain("select=id%2Corg_id%2Cphoto_path%2Cstatus%2Cclosed_at");
    }
  });

  it("propaga el error HTTP", async () => {
    const fakeFetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    await expect(fetchClosedWithPhoto("https://x.supabase.co", {}, "2026-08-03T00:00:00.000Z", fakeFetch, 2)).rejects.toThrow(/500/);
  });
});

type Req = { method: string; url: string; body: unknown };
function router(handler: (r: Req) => unknown, reqs: Req[] = []) {
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const r: Req = { method: init?.method ?? "GET", url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    reqs.push(r);
    const out = handler(r);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out ?? []), { status: 200 });
  }) as typeof fetch;
  return { f, reqs };
}

const uuidN = (n: number) => `0b1e2c3d-4e5f-4a6b-8c7d-${String(n).padStart(12, "0")}`;

describe("purgeExpired — lotes completos (careo R2)", () => {
  const expired = Array.from({ length: 5 }, (_, i) => ({ id: uuidN(100 + i), photo_path: `${ORG}/${uuidN(i)}.jpg` }));

  it("borra y vacía por lotes; solo vacía photo_path de lo que Storage confirma borrado", async () => {
    const { f, reqs } = router((r) => {
      if (r.method === "DELETE") {
        const prefixes = (r.body as { prefixes: string[] }).prefixes;
        // Storage no confirma la 2.ª foto.
        return prefixes.filter((p) => p !== `${ORG}/${uuidN(1)}.jpg`).map((name) => ({ name }));
      }
      return new Response(null, { status: 204 });
    });
    const out = await purgeExpired("https://x.supabase.co", {}, expired, f, 2);
    expect(out).toEqual({ deleted: 4, cleared: 4, notDeleted: [`${ORG}/${uuidN(1)}.jpg`] });
    const methods = reqs.map((r) => r.method);
    expect(methods).toEqual(["DELETE", "PATCH", "DELETE", "PATCH", "DELETE", "PATCH"]);
    const patched = reqs.filter((r) => r.method === "PATCH").map((r) => decodeURIComponent(new URL(r.url).search));
    expect(patched[0]).toContain(uuidN(100));
    expect(patched[0]).not.toContain(uuidN(101));
    for (const r of reqs) expect(r.url.length).toBeLessThan(2000);
  });

  it("si falla el PATCH de un lote, para con error (no sigue borrando)", async () => {
    const { f, reqs } = router((r) => (r.method === "DELETE" ? (r.body as { prefixes: string[] }).prefixes.map((name) => ({ name })) : new Response("x", { status: 500 })));
    await expect(purgeExpired("https://x.supabase.co", {}, expired, f, 2)).rejects.toThrow(/500/);
    expect(reqs.filter((r) => r.method === "DELETE")).toHaveLength(1);
  });
});

describe("findOrphans — fotos sin parte que las referencie (careo R2)", () => {
  const old = new Date(NOW.getTime() - 48 * 3600 * 1000).toISOString();
  const fresh = new Date(NOW.getTime() - 2 * 3600 * 1000).toISOString();
  const obj = (name: string, created_at = old, id: string | null = "obj") => ({ name, created_at, id });

  it("devuelve rutas completas de objetos > 24 h, con formato válido y sin referencia", () => {
    const referenced = new Set([`${ORG}/${uuidN(1)}.jpg`]);
    const out = findOrphans(ORG, [obj(`${uuidN(1)}.jpg`), obj(`${uuidN(2)}.png`), obj(`${uuidN(3)}.webp`, fresh), obj("readme.txt"), obj("sub", old, null)], referenced, NOW, 24);
    expect(out).toEqual([`${ORG}/${uuidN(2)}.png`]);
  });
});

describe("sweepOrphans — recorre orgs, lista Storage y borra huérfanos (careo R2)", () => {
  it("simulación: no borra; apply: borra solo los huérfanos", async () => {
    const old = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const handler = (r: Req) => {
      const u = new URL(r.url);
      if (r.url.includes("/rest/v1/organizations")) return u.searchParams.get("id") ? [] : [{ id: ORG }];
      if (r.url.includes("/rest/v1/maintenance_tickets")) {
        if (u.searchParams.get("photo_path")?.startsWith("in.")) return [];
        return u.searchParams.get("id") ? [] : [{ id: "t1", photo_path: `${ORG}/${uuidN(1)}.jpg` }];
      }
      if (r.url.includes("/storage/v1/object/list/")) {
        const b = r.body as { offset: number };
        return b.offset === 0 ? [{ name: `${uuidN(1)}.jpg`, id: "a", created_at: old }, { name: `${uuidN(2)}.jpg`, id: "b", created_at: old }] : [];
      }
      if (r.method === "DELETE") return (r.body as { prefixes: string[] }).prefixes.map((name) => ({ name }));
      return [];
    };
    const dry = router(handler);
    expect(await sweepOrphans("https://x.supabase.co", {}, { apply: false }, dry.f)).toEqual({ orphans: [`${ORG}/${uuidN(2)}.jpg`], deleted: 0 });
    expect(dry.reqs.some((r) => r.method === "DELETE")).toBe(false);

    const real = router(handler);
    expect(await sweepOrphans("https://x.supabase.co", {}, { apply: true }, real.f)).toEqual({ orphans: [`${ORG}/${uuidN(2)}.jpg`], deleted: 1 });
    const del = real.reqs.filter((r) => r.method === "DELETE");
    expect(del.map((r) => r.body)).toEqual([{ prefixes: [`${ORG}/${uuidN(2)}.jpg`] }]);
  });
});

describe("sweepOrphans — re-comprueba referencias justo antes de borrar (careo R3)", () => {
  it("no borra una huérfana que un parte ha empezado a referenciar después del snapshot", async () => {
    const old = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const late = `${ORG}/${uuidN(2)}.jpg`;
    const handler = (r: Req) => {
      const u = new URL(r.url);
      if (u.pathname.endsWith("/organizations")) return u.searchParams.get("id") ? [] : [{ id: ORG }];
      if (u.pathname.endsWith("/maintenance_tickets")) {
        // Snapshot inicial (por org): nada referenciado. Re-comprobación (photo_path=in.(...)): ya referenciada.
        if (u.searchParams.get("photo_path")?.startsWith("in.")) return [{ photo_path: late }];
        return [];
      }
      if (u.pathname.includes("/storage/v1/object/list/")) {
        const b = r.body as { offset: number };
        return b.offset === 0 ? [{ name: `${uuidN(2)}.jpg`, id: "b", created_at: old }] : [];
      }
      if (r.method === "DELETE") return (r.body as { prefixes: string[] }).prefixes.map((name) => ({ name }));
      return [];
    };
    const { f, reqs } = router(handler);
    expect(await sweepOrphans("https://x.supabase.co", {}, { apply: true }, f)).toEqual({ orphans: [late], deleted: 0 });
    expect(reqs.some((r) => r.method === "DELETE")).toBe(false);
    const recheck = reqs.find((r) => new URL(r.url).searchParams.get("photo_path")?.startsWith("in."));
    expect(new URL(recheck!.url).searchParams.get("photo_path")).toBe(`in.("${late}")`);
  });

  it("pagina las tablas por cursor de id (id=gt.<último>), no por offset", async () => {
    const { f, reqs } = router((r) => {
      const u = new URL(r.url);
      if (u.pathname.endsWith("/organizations")) return [];
      return [];
    });
    await sweepOrphans("https://x.supabase.co", {}, { apply: false }, f);
    const orgReq = reqs.find((r) => r.url.includes("/organizations"))!;
    expect(new URL(orgReq.url).searchParams.get("offset")).toBeNull();
    expect(new URL(orgReq.url).searchParams.get("order")).toBe("id.asc");
  });
});
