/**
 * Tests de API de los route handlers de auth (sin red, Supabase mockeado).
 * Verifican fallo cerrado: cualquier camino que no sea un intercambio válido
 * acaba en /login?error=..., y el parámetro `next` no puede sacar al usuario
 * del dominio.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient.mockImplementation(() => ({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession, verifyOtp: mocks.verifyOtp },
  })),
}));

import { GET as callbackGET } from "@/app/auth/callback/route";
import { GET as confirmGET } from "@/app/auth/confirm/route";

const ORIGIN = "https://relevo.example";
const location = (res: Response) => new URL(res.headers.get("location") ?? "", ORIGIN);

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mocks.exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
  mocks.verifyOtp.mockReset().mockResolvedValue({ error: null });
  mocks.createServerClient.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /auth/callback", () => {
  it("sin code redirige a /login?error=auth sin tocar Supabase", async () => {
    const res = await callbackGET(new Request(`${ORIGIN}/auth/callback`));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(location(res).pathname).toBe("/login");
    expect(location(res).searchParams.get("error")).toBe("auth");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("con code válido intercambia la sesión y va a /dashboard", async () => {
    const res = await callbackGET(new Request(`${ORIGIN}/auth/callback?code=abc`));
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(location(res).href).toBe(`${ORIGIN}/dashboard`);
  });

  it("respeta next cuando es una ruta interna", async () => {
    const res = await callbackGET(new Request(`${ORIGIN}/auth/callback?code=abc&next=/tickets/new`));
    expect(location(res).href).toBe(`${ORIGIN}/tickets/new`);
  });

  it("ignora next si apunta fuera del dominio (open redirect)", async () => {
    for (const next of ["https://evil.example/", "//evil.example", "/\\evil.example"]) {
      const res = await callbackGET(new Request(`${ORIGIN}/auth/callback?code=abc&next=${encodeURIComponent(next)}`));
      expect(location(res).origin, next).toBe(ORIGIN);
      expect(location(res).pathname, next).toBe("/dashboard");
    }
  });

  it("si el intercambio falla redirige a /login?error=auth", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid" } });
    const res = await callbackGET(new Request(`${ORIGIN}/auth/callback?code=bad`));
    expect(location(res).pathname).toBe("/login");
    expect(location(res).searchParams.get("error")).toBe("auth");
  });

  it("sin variables de Supabase falla cerrado con error=config en vez de lanzar", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await callbackGET(new Request(`${ORIGIN}/auth/callback?code=abc`));
    expect(location(res).pathname).toBe("/login");
    expect(location(res).searchParams.get("error")).toBe("config");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});

describe("GET /auth/confirm", () => {
  it("sin token_hash o type redirige a /login?error=auth", async () => {
    for (const qs of ["", "?token_hash=abc", "?type=magiclink"]) {
      const res = await confirmGET(new Request(`${ORIGIN}/auth/confirm${qs}`));
      expect(location(res).searchParams.get("error"), qs).toBe("auth");
    }
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("verifica el OTP con type permitido y va a /dashboard", async () => {
    const res = await confirmGET(new Request(`${ORIGIN}/auth/confirm?token_hash=abc&type=magiclink`));
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "magiclink" });
    expect(location(res).href).toBe(`${ORIGIN}/dashboard`);
  });

  it("rechaza un type fuera del catálogo de EmailOtpType sin llamar a Supabase", async () => {
    const res = await confirmGET(new Request(`${ORIGIN}/auth/confirm?token_hash=abc&type=sms`));
    expect(location(res).searchParams.get("error")).toBe("auth");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("si la verificación falla redirige a /login?error=auth", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    const res = await confirmGET(new Request(`${ORIGIN}/auth/confirm?token_hash=abc&type=email`));
    expect(location(res).searchParams.get("error")).toBe("auth");
  });

  it("sin variables de Supabase falla cerrado con error=config", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const res = await confirmGET(new Request(`${ORIGIN}/auth/confirm?token_hash=abc&type=email`));
    expect(location(res).searchParams.get("error")).toBe("config");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});
