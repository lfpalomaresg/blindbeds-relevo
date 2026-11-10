import type { RpcError } from "@/lib/handover-errors";

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
