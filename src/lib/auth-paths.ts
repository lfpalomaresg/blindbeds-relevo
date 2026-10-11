/**
 * Reglas de acceso compartidas por el proxy y los route handlers de auth.
 * Sin dependencias de Next ni de Supabase para que sean triviales de testear.
 */

/** Rutas accesibles sin sesión. Coincidencia exacta salvo los iconos de la PWA. */
const PUBLIC_EXACT = new Set([
  "/login",
  "/auth/callback",
  "/auth/confirm",
  "/manifest.json",
  "/sw.js",
]);

const PUBLIC_PREFIXES = ["/icon-"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/** Destinos que nunca deben usarse como `next` tras autenticarse (bucles). */
const NEVER_NEXT = new Set(["/login", "/auth/callback", "/auth/confirm"]);

/**
 * Devuelve `raw` solo si es una ruta interna segura; si no, `fallback`.
 * Acepta exclusivamente "/" seguido de un carácter que no sea "/" ni "\",
 * sin esquema, sin host y sin "//" codificado.
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  if (!/^\/(?![/\\])/.test(raw)) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  if (/%2f%2f|%5c/i.test(raw)) return fallback;
  const pathOnly = raw.split(/[?#]/)[0];
  if (NEVER_NEXT.has(pathOnly)) return fallback;
  return raw;
}

/** Variables públicas imprescindibles para hablar con Supabase. */
export function hasSupabaseEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Valores admitidos por supabase.auth.verifyOtp({ type }) para enlaces de email. */
export const EMAIL_OTP_TYPES = ["email", "magiclink", "signup", "invite", "recovery", "email_change"] as const;
export type EmailOtpTypeValue = (typeof EMAIL_OTP_TYPES)[number];

export function isEmailOtpType(value: string | null): value is EmailOtpTypeValue {
  return value !== null && (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}
