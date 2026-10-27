/** Mensajes para los `?error=` que devuelven /auth/callback y /auth/confirm. */
const LOGIN_ERRORS: Record<string, string> = {
  auth: "El enlace de acceso no es válido o ha caducado. Pide uno nuevo.",
  config: "La aplicación no está configurada para iniciar sesión. Avisa al administrador.",
};
const GENERIC_ERROR = "No se ha podido iniciar sesión. Inténtalo de nuevo.";

/** Nunca refleja el valor recibido: solo claves conocidas o el mensaje genérico. */
export function loginErrorMessage(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  return Object.hasOwn(LOGIN_ERRORS, value) ? LOGIN_ERRORS[value] : GENERIC_ERROR;
}

/** Lo que devuelve `signInWithOtp` en `error` (subconjunto de AuthError). */
export interface OtpError {
  code?: string;
  status?: number;
  message?: string;
}

export type OtpOutcome = { sent: true } | { sent: false; message: string };

// Alta cerrada (shouldCreateUser: false + enable_signup = false): un correo que no
// existe recibe uno de estos códigos. Se responde igual que si existiera para no
// delatar qué correos están dados de alta.
const NOT_REGISTERED_CODES = new Set(["otp_disabled", "signup_disabled", "user_not_found"]);

/** Traduce el resultado de pedir un enlace mágico. Nunca muestra el texto de Supabase. */
export function otpRequestOutcome(error: OtpError | null): OtpOutcome {
  if (!error) return { sent: true };
  if (error.code && NOT_REGISTERED_CODES.has(error.code)) return { sent: true };
  if (error.code === "over_email_send_rate_limit" || error.status === 429) {
    const seconds = Number(/after (\d+) seconds?/i.exec(error.message ?? "")?.[1] ?? 0);
    const wait = seconds > 1 ? `${seconds} segundos` : "un momento";
    return { sent: false, message: `Ya te hemos enviado un enlace. Espera ${wait} para pedir otro.` };
  }
  if (error.code === "email_address_invalid" || error.code === "validation_failed") {
    return { sent: false, message: "Ese correo no es válido. Revísalo." };
  }
  return { sent: false, message: "No se ha podido enviar el enlace. Inténtalo de nuevo en un momento." };
}
