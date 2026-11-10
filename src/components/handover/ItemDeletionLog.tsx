"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/members";
import { DEPARTMENTS, HANDOVER_BLOCKS, SHIFT_TYPES } from "@/types";

/** Fila de handover_item_deletion_log (000020). Sin contenido: solo metadatos. */
interface DeletionLogRow {
  deleted_at: string;
  deleted_by_email: string | null;
  handover_id: string;
  handover_created_at: string | null;
  department: string | null;
  shift_type: string | null;
  block: string;
}

const LOAD_ERROR = "No se pudo cargar el rastro de borrados. Recarga la página; si sigue igual, avisa al operador.";

const label = (list: { value: string; label: string }[], value: string | null) =>
  list.find((x) => x.value === value)?.label ?? value ?? "";

/**
 * Rastro de borrados de bloques del relevo, solo lectura y solo para el admin.
 * El rol se mira aquí solo para no pintar la sección: quien decide es el
 * servidor (handover_item_deletion_log da cero filas a quien no es admin de un
 * hotel activo). Copia campo a campo: aunque llegara un campo de más, no se
 * pinta.
 */
export function ItemDeletionLog({ orgId }: { orgId: string }) {
  const supabase = useMemo(() => createBrowserClient(), []);
  // Todo el estado va atado al hotel para el que se cargó: al cambiar de
  // hotel no se pinta nada del anterior mientras se comprueba el nuevo.
  const [loaded, setLoaded] = useState<{ orgId: string; rows: DeletionLogRow[] | null; error: string } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { data: membership } = await supabase
        .from("memberships")
        .select("role")
        .eq("org_id", orgId)
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (!active || (membership as { role?: string } | null)?.role !== "admin") return;
      setLoaded({ orgId, rows: null, error: "" });
      const { data, error: rpcError } = await supabase.rpc("handover_item_deletion_log", { p_org_id: orgId });
      if (!active) return;
      if (rpcError || !Array.isArray(data)) {
        setLoaded({ orgId, rows: null, error: LOAD_ERROR });
        return;
      }
      setLoaded({
        orgId,
        error: "",
        rows: (data as DeletionLogRow[]).map((r) => ({
          deleted_at: r.deleted_at,
          deleted_by_email: r.deleted_by_email,
          handover_id: r.handover_id,
          handover_created_at: r.handover_created_at,
          department: r.department,
          shift_type: r.shift_type,
          block: r.block,
        })),
      });
    })();
    return () => { active = false; };
  }, [orgId, supabase]);

  if (!loaded || loaded.orgId !== orgId) return null;
  const { rows, error } = loaded;

  return (
    <section aria-labelledby="item-deletion-log-title" className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-2">
      <h2 id="item-deletion-log-title" className="text-sm font-medium text-gray-700">Rastro de borrados</h2>
      <p className="text-xs text-gray-500">
        Bloques borrados de relevos de este hotel: quién, cuándo y de qué relevo. El texto borrado no se guarda.
      </p>
      {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
      {rows === null && !error && <p className="text-sm text-gray-500">Cargando...</p>}
      {rows !== null && rows.length === 0 && <p className="text-sm text-gray-500">No hay borrados registrados.</p>}
      {rows !== null && rows.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <li key={`${r.handover_id}-${r.deleted_at}-${i}`} className="py-2 text-sm text-gray-700">
              <span className="font-medium">{label(HANDOVER_BLOCKS, r.block)}</span>
              {" · borrado el "}
              <time dateTime={r.deleted_at}>{formatDateTime(r.deleted_at)}</time>
              {" por "}
              <span className="wrap-anywhere">{r.deleted_by_email ?? "usuario desconocido"}</span>
              <span className="block text-xs text-gray-500">
                {r.handover_created_at ? (
                  <Link href={`/handover/${r.handover_id}`} className="text-orange-600 hover:underline">
                    Relevo de {label(DEPARTMENTS, r.department)} · {label(SHIFT_TYPES, r.shift_type)} ·{" "}
                    {formatDateTime(r.handover_created_at)}
                  </Link>
                ) : (
                  "Relevo ya eliminado por la retención de 90 días"
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
