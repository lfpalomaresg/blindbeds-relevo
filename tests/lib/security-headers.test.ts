import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

// Cabeceras de seguridad que Next añade a todas las respuestas (next.config.ts).
// Producción (10/11/2026) solo enviaba HSTS: la app se podía enmarcar en otra
// web (clickjacking sobre «Borrar», «Cerrar parte», «Resolver»).

async function globalHeaders(): Promise<Record<string, string>> {
  expect(typeof nextConfig.headers).toBe("function");
  const rules = await nextConfig.headers!();
  const out: Record<string, string> = {};
  for (const rule of rules) {
    // Solo reglas globales: esta batería exige que valgan para cualquier ruta.
    if (rule.source !== "/:path*") continue;
    expect(rule.has ?? []).toEqual([]);
    expect(rule.missing ?? []).toEqual([]);
    for (const { key, value } of rule.headers) out[key.toLowerCase()] = value;
  }
  return out;
}

describe("cabeceras de seguridad (next.config.ts)", () => {
  it("prohíbe enmarcar la app (X-Frame-Options y frame-ancestors)", async () => {
    const h = await globalHeaders();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["content-security-policy"]).toMatch(/(^|;)\s*frame-ancestors 'none'\s*(;|$)/);
  });

  it("la CSP no restringe scripts ni estilos (Next inyecta inline sin nonce)", async () => {
    const h = await globalHeaders();
    const directives = h["content-security-policy"].split(";").map((d) => d.trim().split(/\s+/)[0]);
    expect(directives).not.toContain("default-src");
    expect(directives).not.toContain("script-src");
    expect(directives).not.toContain("style-src");
  });

  it("nosniff y Referrer-Policy sin ruta ni query hacia otros orígenes", async () => {
    const h = await globalHeaders();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("Permissions-Policy: cámara solo en el propio origen (escáner QR); micrófono y ubicación desactivados", async () => {
    const h = await globalHeaders();
    const policy = Object.fromEntries(
      h["permissions-policy"].split(",").map((p) => p.trim().split("=") as [string, string]),
    );
    expect(policy.camera).toBe("(self)");
    expect(policy.microphone).toBe("()");
    expect(policy.geolocation).toBe("()");
  });
});
