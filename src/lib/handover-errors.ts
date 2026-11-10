import { LIMITS } from "@/lib/validation";

/** Lo que devuelve `supabase.rpc` en `error` (subconjunto de PostgrestError). */
export interface RpcError {
  code?: string;
  message?: string;
}

// Textos de los `raise ... using errcode = '22023'` de create_handover
// (supabase/migrations/000017_handover_limits.sql). Normalmente la validación
// del cliente los para antes; llegan si la app en caché es antigua.
export const LIMIT_MESSAGES: Record<string, string> = {
  "handover requires at least one item": "Escribe al menos un bloque antes de registrar el relevo.",
  "handover allows at most 4 items": "El relevo admite como mucho 4 bloques.",
  "handover allows one item per block": "Hay dos textos en el mismo bloque: un solo texto por bloque.",
  "every handover item needs non-empty content": "Ningún bloque puede ir vacío.",
  [`handover item content must be at most ${LIMITS.handoverContent} characters`]:
    `Cada bloque admite como máximo ${LIMITS.handoverContent} caracteres.`,
};

const GENERIC_LIMIT = "El servidor ha rechazado el relevo por sus límites. Revisa los bloques y vuelve a intentarlo.";

const NO_ACCESS = "No tienes acceso para registrar relevos en este hotel. Vuelve a iniciar sesión; si sigue igual, avisa al administrador.";
const GENERIC = "No se pudo registrar el relevo. Comprueba en «Relevos» si ya está guardado antes de repetirlo.";

/**
 * Mensaje para el error de create_handover. Nunca muestra el texto del
 * servidor (puede nombrar tablas, funciones o políticas internas): 22023
 * conocidos → su traducción; 42501 → sin acceso; lo demás → genérico.
 */
export function createHandoverErrorMessage(error: RpcError): string {
  if (error.code === "22023") {
    const message = error.message ?? "";
    return Object.hasOwn(LIMIT_MESSAGES, message) ? LIMIT_MESSAGES[message] : GENERIC_LIMIT;
  }
  if (error.code === "42501") return NO_ACCESS;
  return GENERIC;
}
