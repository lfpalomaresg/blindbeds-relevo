"use client";

import { useState, useEffect, useMemo } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { HandoverItem } from "@/types";
import { HANDOVER_BLOCKS } from "@/types";

interface PendingItemsProps {
  orgId: string;
}

export function PendingItems({ orgId }: PendingItemsProps) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [items, setItems] = useState<HandoverItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    setError("");
    setNotice("");
    // Solo los no resueltos: si otra persona ya lo resolvió, no se pisa quién y cuándo.
    const { data: changed, error: updateError } = await supabase
      .from("handover_items")
      .update({ resolved: true, resolved_by: userData.user.id, resolved_at: new Date().toISOString() })
      .eq("id", id)
      .eq("resolved", false)
      .select("id");

    if (updateError) {
      setError("No se pudo resolver el pendiente: " + updateError.message);
      return;
    }
    if (!changed || changed.length === 0) {
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
            onClick={() => resolveItem(item.id)}
            className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 shrink-0"
          >
            Resolver
          </button>
        </div>
      ))}
    </div>
  );
}