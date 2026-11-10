import type { RpcError } from "@/lib/handover-errors";
import { LIMITS } from "@/lib/validation";

// Códigos de los `raise` de change_ticket_status
// (supabase/migrations/000013_ticket_rpc.sql). Un parte de otra organización o
// que ya cambió de estado no es un error: la función devuelve false.
export const KNOWN_TICKET_STATUS_CODES = ["42501", "22023"] as const;

const NO_SESSION =
  "No tienes una sesión válida para cambiar este parte. Vuelve a iniciar sesión; si sigue igual, avisa al administrador.";
const INVALID_TRANSITION = "Ese cambio de estado no está permitido para este parte. Recarga la página y vuelve a intentarlo.";
const GENERIC = "No se pudo cambiar el estado del parte. Vuelve a intentarlo en unos segundos.";

/**
 * Mensaje para el error de change_ticket_status. Nunca muestra el texto del
 * servidor (puede nombrar tablas, funciones o políticas internas):
 * 42501 → sesión; 22023 → transición no permitida; lo demás → genérico.
 */
export function changeTicketStatusErrorMessage(error: RpcError): string {
  if (error.code === "42501") return NO_SESSION;
  if (error.code === "22023") return INVALID_TRANSITION;
  return GENERIC;
}

// Textos de los `raise ... using errcode = '22023'` de create_ticket
// (supabase/migrations/000013_ticket_rpc.sql). Normalmente la validación del
// cliente los para antes; llegan si la app en caché es antigua.
export const CREATE_TICKET_LIMIT_MESSAGES: Record<string, string> = {
  "title must be 1..120 characters": `El título es obligatorio y admite como máximo ${LIMITS.ticketTitle} caracteres.`,
  "description must be at most 2000 characters":
    `La descripción admite como máximo ${LIMITS.ticketDescription} caracteres.`,
};

/** Texto del 42501 de create_ticket cuando la foto no es de quien crea el parte o es antigua. */
export const CREATE_TICKET_PHOTO_REJECTED = "photo not found, not yours or too old";

const CREATE_GENERIC_LIMIT = "El servidor ha rechazado el parte por sus límites. Revisa los campos y vuelve a intentarlo.";
const CREATE_PHOTO_REJECTED =
  "No se pudo adjuntar la foto al parte. Vuelve a elegir la foto y crea el parte de nuevo.";
const CREATE_NO_ACCESS =
  "No tienes acceso para crear partes en este hotel. Vuelve a iniciar sesión; si sigue igual, avisa al administrador.";
const CREATE_GENERIC =
  "No se pudo crear el parte. Comprueba en el panel si ya aparece antes de repetirlo.";

/**
 * Mensaje para el error de create_ticket. Nunca muestra el texto del servidor:
 * 22023 conocidos → su traducción; 42501 de la foto → volver a elegirla;
 * otro 42501 → sin acceso; lo demás → genérico (el error puede ser ambiguo:
 * el parte pudo crearse y perderse la respuesta).
 */
export function createTicketErrorMessage(error: RpcError): string {
  const message = error.message ?? "";
  if (error.code === "22023") {
    return Object.hasOwn(CREATE_TICKET_LIMIT_MESSAGES, message)
      ? CREATE_TICKET_LIMIT_MESSAGES[message]
      : CREATE_GENERIC_LIMIT;
  }
  if (error.code === "42501") {
    return message === CREATE_TICKET_PHOTO_REJECTED ? CREATE_PHOTO_REJECTED : CREATE_NO_ACCESS;
  }
  return CREATE_GENERIC;
}

/** Mensaje para un fallo al subir la foto a Storage: siempre este, nunca el texto del servidor. */
export const TICKET_PHOTO_UPLOAD_ERROR =
  "No se pudo subir la foto. Revisa la conexión y vuelve a intentarlo, o crea el parte sin foto.";
