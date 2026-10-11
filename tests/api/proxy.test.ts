/**
 * Tests del proxy (antes middleware) de autenticación: fallo cerrado sin sesión.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient.mockImplementation(() => ({
    auth: { getUser: mocks.getUser },
  })),
}));

import { proxy, config } from "@/proxy";

const ORIGIN = "https://relevo.example";
const req = (path: string) => new NextRequest(`${ORIGIN}${path}`);

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: null } });
  mocks.createServerClient.mockClear();
});

describe("proxy de autenticación", () => {
  it("exporta un matcher que excluye los estáticos de Next", () => {
    expect(config.matcher.join("|")).toMatch(/_next\/static/);
  });

  it.each(["/dashboard", "/", "/handover/new", "/tickets/new", "/loginx"])(
    "sin sesión redirige %s a /login",
    async (path) => {
      const res = await proxy(req(path));
      expect(res.status).toBeGreaterThanOrEqual(300);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    },
  );

  it("con sesión deja pasar", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await proxy(req("/dashboard"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(["/login", "/auth/callback", "/auth/confirm", "/manifest.json", "/sw.js", "/icon-192.png"])(
    "la ruta pública %s pasa sin consultar Supabase",
    async (path) => {
      const res = await proxy(req(path));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
      expect(mocks.createServerClient).not.toHaveBeenCalled();
    },
  );

  it("si Supabase devuelve error al leer el usuario, falla cerrado (redirige)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "boom" } });
    const res = await proxy(req("/dashboard"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("sin variables de entorno de Supabase falla cerrado con error=config", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await proxy(req("/dashboard"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("error")).toBe("config");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});
