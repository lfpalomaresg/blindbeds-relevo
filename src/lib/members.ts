import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Directorio de autores de una organización: user_id → email.
 *
 * Usa la función org_member_directory (000007), que solo devuelve miembros de
 * una organización a la que pertenece quien llama. Si falla, devuelve un mapa
 * vacío: la lista se muestra igual, con «Autor no disponible».
 */
export async function fetchMemberDirectory(
  supabase: Pick<SupabaseClient, "rpc">,
  orgId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc("org_member_directory", { p_org_id: orgId });
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
