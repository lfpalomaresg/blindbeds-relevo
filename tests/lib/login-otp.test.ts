import { describe, expect, it } from "vitest";
import { otpRequestOutcome } from "@/lib/login-errors";

// F2 y alta abierta (informe e2e 27/10): lo que ve quien pide un enlace mágico.
describe("otpRequestOutcome", () => {
  it("sin error, el enlace va en camino", () => {
    expect(otpRequestOutcome(null)).toEqual({ sent: true });
  });

  it("un correo que no está dado de alta se trata igual que uno que sí (no delata quién existe)", () => {
    for (const code of ["otp_disabled", "signup_disabled", "user_not_found"]) {
      expect(otpRequestOutcome({ code, status: 422, message: "Signups not allowed for otp" })).toEqual({ sent: true });
    }
  });

  it("el límite de envíos se explica en español con los segundos de espera", () => {
    const r = otpRequestOutcome({
      code: "over_email_send_rate_limit",
      status: 429,
      message: "For security purposes, you can only request this after 42 seconds.",
    });
    expect(r).toEqual({ sent: false, message: "Ya te hemos enviado un enlace. Espera 42 segundos para pedir otro." });
  });

  it("si no trae segundos (o son 0-1), no se inventa una cifra", () => {
    for (const message of ["Email rate limit exceeded", "you can only request this after 0 seconds"]) {
      const r = otpRequestOutcome({ code: "over_email_send_rate_limit", status: 429, message });
      expect(r).toEqual({ sent: false, message: "Ya te hemos enviado un enlace. Espera un momento para pedir otro." });
    }
  });

  it("correo no válido", () => {
    expect(otpRequestOutcome({ code: "email_address_invalid", status: 400, message: "Email address is invalid" })).toEqual({
      sent: false,
      message: "Ese correo no es válido. Revísalo.",
    });
  });

  it("cualquier otro error da un mensaje genérico en español, nunca el texto de Supabase", () => {
    const r = otpRequestOutcome({ code: "unexpected_failure", status: 500, message: "Internal Server Error" });
    expect(r).toEqual({ sent: false, message: "No se ha podido enviar el enlace. Inténtalo de nuevo en un momento." });
  });
});
