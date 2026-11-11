"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { HandoverItem } from "@/types";
import { HANDOVER_BLOCKS } from "@/types";

// Errores de resolve_handover_item. Un ítem ajeno o ya resuelto no es error:
// la función devuelve false. 42501 (insufficient_privilege) llega sin sesión en
// el servidor y también con un usuario sin permiso de ejecución (token caducado
// que entra como anon, EXECUTE retirado): el mensaje nombra ambas causas.
const NO_SESSION =
  "No se pudo resolver el pendiente: no hay sesión activa. Vuelve a iniciar sesión; si sigue igual, avisa al responsable del hotel.";
const NO_ACCESS =
  "No se pudo resolver el pendiente: no tienes acceso a este pendiente o tu sesión caducó. Recarga la página; si sigue igual, avisa al responsable del hotel.";
const GENERIC_ERROR = "No se pudo resolver el pendiente. Vuelve a intentarlo en unos segundos.";

interface PendingItemsProps {
  orgId: string;
}

export function PendingItems({ orgId }: PendingItemsProps) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [items, setItems] = useState<HandoverItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Pendientes con una resolución en curso: un doble toque no manda otra RPC
  // (la segunda devolvería false y saldría «ya estaba resuelto por otra persona»).
  const inFlight = useRef(new Set<string>());
  const [resolving, setResolving] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabase
        .from("handover_items")
        .select("*")
        .eq("org_id", orgId)
        .eq("resolved", false)
        .order("created_at", { ascending: false });
      if (!active) return;
      setItems(data ? (data as HandoverItem[]) : []);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [orgId, supabase]);

  async function resolveItem(id: string) {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setResolving(new Set(inFlight.current));
    try {
      await resolveOnce(id);
    } finally {
      inFlight.current.delete(id);
      setResolving(new Set(inFlight.current));
    }
  }

  async function resolveOnce(id: string) {
    setError("");
    setNotice("");
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setError(NO_SESSION);
      return;
    }

    // Migración 000014: resolve_handover_item fija quién y cuándo en la base de
    // datos y solo actúa si no estaba resuelto (devuelve false si otra persona
    // se adelantó). La app ya no hace UPDATE directo.
    const { data: changed, error: updateError } = await supabase.rpc("resolve_handover_item", {
      p_item_id: id,
    });

    if (updateError) {
      // Nunca el texto del servidor: puede nombrar tablas, funciones o políticas.
      setError(updateError.code === "42501" ? NO_ACCESS : GENERIC_ERROR);
      return;
    }
    if (changed !== true) {
      // false cubre dos casos: otra persona lo resolvió antes, o quien pulsa ya
      // no tiene acceso (hotel suspendido, membresía retirada). Se vuelve a
      // leer el ítem: RLS lo oculta en el segundo caso.
      const { data: current, error: readError } = await supabase
        .from("handover_items")
        .select("id, resolved")
        .eq("id", id)
        .maybeSingle();
      if (readError || !current || (current as { resolved?: boolean }).resolved !== true) {
        setError(
          "No se pudo resolver el pendiente: puede que tu acceso a este hotel no esté activo. Recarga la página y, si sigue, avisa al responsable del hotel.",
        );
        return;
      }
      setNotice("Ese pendiente ya estaba resuelto por otra persona.");
    }

    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  if (loading) return <p className="text-gray-500 text-sm">Cargando...</p>;

  const messages = (
    <>
      {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
      {notice && <p role="status" className="text-gray-600 text-sm">{notice}</p>}
    </>
  );

  if (items.length === 0) {
    return (
      <div className="space-y-2">
        {messages}
        <p className="text-gray-500 text-sm">No hay pendientes. ✅</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {messages}
      {items.map((item) => (
        <div key={item.id} className="flex items-start justify-between gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="min-w-0">
            <span className="text-xs font-medium text-amber-600 uppercase">
              {HANDOVER_BLOCKS.find((b) => b.value === item.block)?.label}
            </span>
            <p className="text-sm text-gray-800 mt-1 wrap-anywhere">{item.content}</p>
            <p className="text-xs text-gray-400 mt-1">
              {new Date(item.created_at).toLocaleDateString("es-ES", {
                day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
              })}
            </p>
          </div>
          <button
            onClick={() => void resolveItem(item.id)}
            disabled={resolving.has(item.id)}
            className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 shrink-0"
          >
            Resolver
          </button>
        </div>
      ))}
    </div>
  );
}