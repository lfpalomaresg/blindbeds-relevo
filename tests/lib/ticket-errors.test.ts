/**
 * changeTicketStatusErrorMessage traduce los errores de change_ticket_status
 * sin mostrar nunca el texto del servidor (puede nombrar tablas, funciones o
 * políticas internas). Los códigos que traduce son, literalmente, los de los
 * `raise` de la definición VIGENTE de change_ticket_status: la de la última
 * migración que la crea o reemplaza (hoy 000013).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KNOWN_TICKET_STATUS_CODES, changeTicketStatusErrorMessage } from "@/lib/ticket-errors";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const DEFINITION = /create or replace function public\.change_ticket_status\b[\s\S]*?\$\$;/gi;

function currentChangeTicketStatus(): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    for (const m of readFileSync(join(MIGRATIONS, file), "utf8").matchAll(DEFINITION)) found = { file, body: m[0] };
  }
  if (!found) throw new Error("ninguna migración define public.change_ticket_status");
  return found;
}

const current = currentChangeTicketStatus();
const raisedCodes = new Set([...current.body.matchAll(/errcode = '([0-9A-Z]{5})'/g)].map((m) => m[1]));

describe("changeTicketStatusErrorMessage", () => {
  it("la definición vigente de change_ticket_status es la de 000013 (si cambia, revisar los códigos)", () => {
    expect(current.file).toBe("000013_ticket_rpc.sql");
  });

  it("cubre exactamente los códigos que lanza la definición vigente", () => {
    expect(raisedCodes.size).toBeGreaterThan(0);
    expect(new Set(KNOWN_TICKET_STATUS_CODES)).toEqual(raisedCodes);
  });

  it("42501 (sin sesión o sin acceso) da un mensaje propio sin el texto del servidor", () => {
    const msg = changeTicketStatusErrorMessage({ code: "42501", message: "authentication required" });
    expect(msg).toMatch(/vuelve a iniciar sesión/i);
    expect(msg).not.toMatch(/authentication|required/);
  });

  it("22023 (transición no permitida) da un mensaje propio sin el texto del servidor", () => {
    const msg = changeTicketStatusErrorMessage({ code: "22023", message: "invalid ticket status transition: cerrado -> abierto" });
    expect(msg).toMatch(/no está permitido/i);
    expect(msg).not.toMatch(/invalid|transition|->/);
  });

  it("cualquier otro error da el genérico y nunca el texto del servidor", () => {
    const other = changeTicketStatusErrorMessage({ code: "42P01", message: 'relation "public.ticket_updates" does not exist' });
    expect(other).toMatch(/no se pudo cambiar el estado/i);
    expect(other).not.toMatch(/relation|ticket_updates|exist/);
    expect(changeTicketStatusErrorMessage({})).toBe(other);
    expect(changeTicketStatusErrorMessage({ message: "permission denied for table maintenance_tickets" })).toBe(other);
  });
});
