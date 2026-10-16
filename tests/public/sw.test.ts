import { readFileSync } from "fs";
import path from "path";
import vm from "vm";
import { describe, expect, it, vi } from "vitest";

/**
 * Ejecuta public/sw.js en un contexto aislado con self/caches/fetch simulados.
 * Así se prueba el fichero real que sirve el navegador, sin bundler.
 */
const SW_SOURCE = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
const ORIGIN = "https://relevo.example";

type Listener = (event: unknown) => void;

function loadServiceWorker(opts: { preexisting?: string[] } = {}) {
  const listeners: Record<string, Listener> = {};
  const stores = new Map<string, Map<string, Response>>();
  for (const name of opts.preexisting ?? []) stores.set(name, new Map([[`${ORIGIN}/dashboard`, new Response("old")]]));

  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      addAll: vi.fn(async (urls: string[]) => {
        for (const u of urls) store.set(new URL(u, ORIGIN).href, new Response("precached"));
      }),
      put: vi.fn(async (req: Request | string, res: Response) => {
        store.set(typeof req === "string" ? new URL(req, ORIGIN).href : req.url, res);
      }),
      match: vi.fn(async (req: Request | string) => store.get(typeof req === "string" ? req : req.url)),
    };
  };

  const caches = {
    open: vi.fn(open),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (name: string) => stores.delete(name)),
    match: vi.fn(async (req: Request | string) => {
      const key = typeof req === "string" ? new URL(req, ORIGIN).href : req.url;
      for (const store of stores.values()) if (store.has(key)) return store.get(key);
      return undefined;
    }),
  };

  const fetchMock = vi.fn(async () => new Response("fresh", { status: 200 }));

  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };

  vm.runInNewContext(SW_SOURCE, { self, caches, fetch: fetchMock, URL, Request, Response, Promise, console });

  /** Lanza un evento fetch y espera a que terminen respondWith y waitUntil. */
  async function dispatchFetch(url: string, init: RequestInit & { mode?: RequestMode } = {}) {
    const { mode, ...rest } = init;
    const request = new Request(new URL(url, ORIGIN).href, rest);
    if (mode === "navigate") Object.defineProperty(request, "mode", { value: "navigate" });
    let responded: Promise<Response> | undefined;
    const pending: Promise<unknown>[] = [];
    listeners.fetch?.({
      request,
      respondWith: (p: Promise<Response>) => {
        responded = Promise.resolve(p);
      },
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    });
    const response = responded ? await responded : undefined;
    await Promise.all(pending);
    // put() se encadena tras clone(); deja correr las microtareas restantes.
    await new Promise((r) => setTimeout(r, 0));
    return { responded: responded !== undefined, response };
  }

  async function dispatchLifecycle(type: "install" | "activate") {
    const pending: Promise<unknown>[] = [];
    listeners[type]?.({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  }

  const cachedUrls = () => [...stores.values()].flatMap((s) => [...s.keys()].map((k) => new URL(k).pathname));

  return { dispatchFetch, dispatchLifecycle, cachedUrls, stores, fetchMock };
}

describe("public/sw.js — no cachea datos de sesión", () => {
  it("install no precachea páginas autenticadas", async () => {
    const sw = loadServiceWorker();
    await sw.dispatchLifecycle("install");
    const cached = sw.cachedUrls();
    for (const p of ["/", "/dashboard", "/handover/new", "/tickets/new"]) expect(cached).not.toContain(p);
  });

  it.each(["/dashboard", "/handover/new", "/tickets/new", "/", "/login"])(
    "no guarda la navegación a %s",
    async (p) => {
      const sw = loadServiceWorker();
      await sw.dispatchFetch(p, { mode: "navigate" });
      expect(sw.cachedUrls()).not.toContain(p);
    },
  );

  it.each(["/api/tickets", "/auth/callback?code=x", "/dashboard?_rsc=abc"])("no guarda %s", async (p) => {
    const sw = loadServiceWorker();
    await sw.dispatchFetch(p);
    expect(sw.cachedUrls()).not.toContain(new URL(p, ORIGIN).pathname);
  });

  it("no sirve desde caché una página autenticada guardada por una versión anterior", async () => {
    const sw = loadServiceWorker({ preexisting: ["relevo-v1"] });
    const { responded, response } = await sw.dispatchFetch("/dashboard", { mode: "navigate" });
    if (responded) expect(await response!.text()).not.toBe("old");
  });

  it("activate borra las cachés de versiones anteriores (relevo-v1 tenía /dashboard)", async () => {
    const sw = loadServiceWorker({ preexisting: ["relevo-v1"] });
    await sw.dispatchLifecycle("activate");
    expect(sw.stores.has("relevo-v1")).toBe(false);
  });

  it("no toca peticiones que no son GET", async () => {
    const sw = loadServiceWorker();
    const { responded } = await sw.dispatchFetch("/_next/static/chunks/app.js", { method: "POST" });
    expect(responded).toBe(false);
    expect(sw.cachedUrls()).toHaveLength(0);
  });

  it("no toca peticiones a otros orígenes (p. ej. Supabase)", async () => {
    const sw = loadServiceWorker();
    const { responded } = await sw.dispatchFetch("https://abc.supabase.co/rest/v1/tickets");
    expect(responded).toBe(false);
    expect(sw.cachedUrls()).toHaveLength(0);
  });
});

describe("public/sw.js — sí cachea recursos estáticos públicos", () => {
  it.each(["/_next/static/chunks/app-123.js", "/manifest.json", "/icon-192.png"])("guarda %s", async (p) => {
    const sw = loadServiceWorker();
    await sw.dispatchFetch(p);
    expect(sw.cachedUrls()).toContain(p);
  });

  it("no guarda respuestas de error ni redirecciones de un estático", async () => {
    const sw = loadServiceWorker();
    sw.fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    await sw.dispatchFetch("/_next/static/chunks/missing.js");
    expect(sw.cachedUrls()).toHaveLength(0);
  });
});
