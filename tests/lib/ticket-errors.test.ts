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
import {
  CREATE_TICKET_LIMIT_MESSAGES,
  CREATE_TICKET_PHOTO_REJECTED,
  KNOWN_TICKET_STATUS_CODES,
  TICKET_PHOTO_UPLOAD_ERROR,
  changeTicketStatusErrorMessage,
  createTicketErrorMessage,
} from "@/lib/ticket-errors";

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

  it("42501 no se explica solo como sesión: también cubre la falta de permiso (p. ej. sin EXECUTE)", () => {
    const msg = changeTicketStatusErrorMessage({ code: "42501", message: "permission denied for function change_ticket_status" });
    expect(msg).toMatch(/no tienes acceso a este parte/i);
    expect(msg).toMatch(/sesión caducó/i);
    expect(msg).not.toMatch(/sesión válida/i);
    expect(msg).not.toMatch(/permission|denied|change_ticket_status/);
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

/**
 * createTicketErrorMessage y TICKET_PHOTO_UPLOAD_ERROR (TicketForm): mismo
 * criterio. Los textos 22023/42501 que traduce son, literalmente, los de los
 * `raise` de la definición VIGENTE de create_ticket.
 */
const CREATE_DEFINITION = /create or replace function public\.create_ticket\b[\s\S]*?\$\$;/gi;

function currentCreateTicket(): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    for (const m of readFileSync(join(MIGRATIONS, file), "utf8").matchAll(CREATE_DEFINITION)) found = { file, body: m[0] };
  }
  if (!found) throw new Error("ninguna migración define public.create_ticket");
  return found;
}

const createTicket = currentCreateTicket();
const raisedByCode = (code: string) =>
  new Set(
    [...createTicket.body.matchAll(/raise exception '([^']+)' using errcode = '([0-9A-Z]{5})'/g)]
      .filter((m) => m[2] === code)
      .map((m) => m[1]),
  );

describe("createTicketErrorMessage", () => {
  it("la definición vigente de create_ticket es la de 000013 (si cambia, revisar los textos)", () => {
    expect(createTicket.file).toBe("000013_ticket_rpc.sql");
  });

  it("traduce exactamente los textos 22023 de la definición vigente", () => {
    const raised = raisedByCode("22023");
    expect(raised.size).toBeGreaterThan(0);
    expect(new Set(Object.keys(CREATE_TICKET_LIMIT_MESSAGES))).toEqual(raised);
  });

  it("los 42501 de la definición vigente son sesión, membresía y foto (si cambian, revisar el mapeo)", () => {
    expect(raisedByCode("42501")).toEqual(
      new Set(["authentication required", "not a member of this organization", "photo not found, not yours or too old"]),
    );
    expect(CREATE_TICKET_PHOTO_REJECTED).toBe("photo not found, not yours or too old");
  });

  it("22023 conocido → su traducción, sin el texto del servidor", () => {
    const title = createTicketErrorMessage({ code: "22023", message: "title must be 1..120 characters" });
    expect(title).toMatch(/título/i);
    expect(title).toMatch(/120/);
    expect(title).not.toMatch(/must|characters/);
    const description = createTicketErrorMessage({ code: "22023", message: "description must be at most 2000 characters" });
    expect(description).toMatch(/descripción/i);
    expect(description).toMatch(/2000/);
  });

  it("22023 desconocido → genérico de límites; un texto heredado del prototipo no sirve de clave", () => {
    const msg = createTicketErrorMessage({ code: "22023", message: "toString" });
    expect(msg).toMatch(/revisa los campos/i);
    expect(msg).not.toMatch(/toString/);
  });

  it("42501 de la foto → pide volver a elegirla; otro 42501 → sin acceso", () => {
    const photo = createTicketErrorMessage({ code: "42501", message: "photo not found, not yours or too old" });
    expect(photo).toMatch(/foto/i);
    expect(photo).not.toMatch(/not found|yours|old/);
    const access = createTicketErrorMessage({ code: "42501", message: "not a member of this organization" });
    expect(access).toMatch(/vuelve a iniciar sesión/i);
    expect(access).not.toMatch(/member|organization/);
    expect(createTicketErrorMessage({ code: "42501", message: "authentication required" })).toBe(access);
  });

  it("cualquier otro error → genérico que avisa de comprobar si el parte ya está creado", () => {
    const other = createTicketErrorMessage({ code: "23514", message: 'new row for relation "maintenance_tickets" violates check constraint' });
    expect(other).toMatch(/comprueba en el panel/i);
    expect(other).not.toMatch(/relation|maintenance_tickets|constraint/);
    expect(createTicketErrorMessage({})).toBe(other);
  });
});

describe("TICKET_PHOTO_UPLOAD_ERROR", () => {
  it("es un mensaje propio que ofrece crear el parte sin foto", () => {
    expect(TICKET_PHOTO_UPLOAD_ERROR).toMatch(/no se pudo subir la foto/i);
    expect(TICKET_PHOTO_UPLOAD_ERROR).toMatch(/sin foto/i);
  });
});
