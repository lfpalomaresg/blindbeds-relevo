"use client";

import { useState, useEffect } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { HandoverItem } from "@/types";
import { HANDOVER_BLOCKS } from "@/types";

interface PendingItemsProps {
  orgId: string;
}

export function PendingItems({ orgId }: PendingItemsProps) {
  const supabase = createBrowserClient();
  const [items, setItems] = useState<HandoverItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadItems();
  }, [orgId]);

  async function loadItems() {
    setLoading(true);
    const { data } = await supabase
      .from("handover_items")
      .select("*")
      .eq("org_id", orgId)
      .eq("resolved", false)
      .order("created_at", { ascending: false });
    if (data) setItems(data as HandoverItem[]);
    setLoading(false);
  }

  async function resolveItem(id: string) {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    await supabase
      .from("handover_items")
      .update({ resolved: true, resolved_by: userData.user.id, resolved_at: new Date().toISOString() })
      .eq("id", id);

    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  if (loading) return <p className="text-gray-500 text-sm">Cargando...</p>;
  if (items.length === 0) return <p className="text-gray-500 text-sm">No hay pendientes. ✅</p>;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="flex items-start justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div>
            <span className="text-xs font-medium text-amber-600 uppercase">
              {HANDOVER_BLOCKS.find((b) => b.value === item.block)?.label}
            </span>
            <p className="text-sm text-gray-800 mt-1">{item.content}</p>
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