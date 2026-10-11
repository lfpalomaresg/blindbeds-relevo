import { afterEach, describe, expect, it } from "vitest";
import { hasSupabaseEnv, isPublicPath, safeNextPath } from "@/lib/auth-paths";

describe("isPublicPath", () => {
  it("deja pasar sin sesión login, callbacks de auth y los ficheros de la PWA", () => {
    for (const p of ["/login", "/auth/callback", "/auth/confirm", "/manifest.json", "/sw.js", "/icon-192.png", "/icon-512.png"]) {
      expect(isPublicPath(p), p).toBe(true);
    }
  });

  it("protege todo lo demás, incluidas variantes que empiezan igual que una ruta pública", () => {
    for (const p of ["/", "/dashboard", "/handover/new", "/tickets/new", "/loginx", "/login-admin", "/authx", "/manifest.json.bak", "/sw.js.map", "/icon-admin", "/icon-report", "/icon-private.json", "/icon-192.png.map"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });
});

describe("safeNextPath", () => {
  it("acepta rutas relativas internas", () => {
    expect(safeNextPath("/tickets/new")).toBe("/tickets/new");
    expect(safeNextPath("/handover/new?x=1")).toBe("/handover/new?x=1");
  });

  it("devuelve el destino por defecto cuando no hay valor", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
  });

  it("neutraliza open redirects (protocolo, //host, backslash, javascript:)", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "dashboard", "/%2F%2Fevil.example", " //evil.example"]) {
      expect(safeNextPath(bad), bad).toBe("/dashboard");
    }
  });

  it("no permite volver a las rutas de auth (bucle) y acepta otro fallback", () => {
    expect(safeNextPath("/auth/callback", "/x")).toBe("/x");
    expect(safeNextPath("/login", "/x")).toBe("/x");
  });
});

describe("hasSupabaseEnv", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = saved.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("es falso si falta cualquiera de las dos variables públicas", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    expect(hasSupabaseEnv()).toBe(false);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(hasSupabaseEnv()).toBe(false);
  });

  it("es verdadero con ambas presentes", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    expect(hasSupabaseEnv()).toBe(true);
  });
});
