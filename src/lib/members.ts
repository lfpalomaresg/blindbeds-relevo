import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Emails de los autores de relevos que se están mostrando: user_id → email.
 *
 * Usa handover_author_emails (000007), que solo devuelve los ids pedidos que
 * hayan escrito relevos en una organización a la que pertenece quien llama
 * (minimización: no es un directorio de la org). Sin ids no llama. Si falla,
 * devuelve un mapa vacío: la lista se muestra igual, con «Autor no disponible».
 */
export async function fetchAuthorEmails(
  supabase: Pick<SupabaseClient, "rpc">,
  orgId: string,
  authorIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(authorIds)];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.rpc("handover_author_emails", { p_org_id: orgId, p_user_ids: ids });
  if (error || !Array.isArray(data)) return new Map();
  return new Map((data as { user_id: string; email: string }[]).map((m) => [m.user_id, m.email]));
}

export const UNKNOWN_AUTHOR = "Autor no disponible";

/** Fecha y hora cortas en español: «2 ene, 07:55». */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
