/**
 * Los textos que traduce createHandoverErrorMessage son, literalmente, los
 * `raise ... errcode = '22023'` de la definición VIGENTE de create_handover:
 * la de la última migración que la crea o reemplaza (hoy 000017). Si una
 * migración posterior cambia o añade un texto, este test falla antes de que
 * el usuario vea inglés.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LIMIT_MESSAGES, createHandoverErrorMessage } from "@/lib/handover-errors";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const DEFINITION = /create or replace function public\.create_handover\b[\s\S]*?\$\$;/gi;

/** Cuerpo de la última definición de create_handover en las migraciones, en orden de aplicación. */
function currentCreateHandover(): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    for (const m of readFileSync(join(MIGRATIONS, file), "utf8").matchAll(DEFINITION)) found = { file, body: m[0] };
  }
  if (!found) throw new Error("ninguna migración define public.create_handover");
  return found;
}

const current = currentCreateHandover();
const raised22023 = [...current.body.matchAll(/raise exception '([^']+)' using errcode = '22023'/g)].map((m) => m[1]);

describe("createHandoverErrorMessage", () => {
  it("la definición vigente de create_handover es la de 000017 (si cambia, revisar los textos)", () => {
    expect(current.file).toBe("000017_handover_limits.sql");
  });

  it("cubre exactamente los textos 22023 de la definición vigente", () => {
    expect(raised22023.length).toBeGreaterThan(0);
    expect(new Set(Object.keys(LIMIT_MESSAGES))).toEqual(new Set(raised22023));
  });

  it("los errores que no son 22023 nunca muestran el texto del servidor", () => {
    const noAccess = createHandoverErrorMessage({ code: "42501", message: "not a member of this organization" });
    expect(noAccess).toMatch(/no tienes acceso/i);
    expect(noAccess).not.toMatch(/member|organization/);
    const other = createHandoverErrorMessage({ code: "23514", message: 'violates check constraint "handover_items_block_check"' });
    expect(other).toMatch(/no se pudo registrar el relevo/i);
    expect(other).not.toMatch(/constraint|handover_items/);
    expect(createHandoverErrorMessage({})).toMatch(/no se pudo registrar el relevo/i);
  });
});
