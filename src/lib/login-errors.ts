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
