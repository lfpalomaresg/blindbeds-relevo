"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { UNKNOWN_AUTHOR, fetchMemberDirectory, formatDateTime } from "@/lib/members";
import type { HandoverItem, ShiftHandover } from "@/types";
import { DEPARTMENTS, HANDOVER_BLOCKS, SHIFT_TYPES } from "@/types";

interface HandoverDetailProps {
  orgId: string;
  handoverId: string;
}

/**
 * Detalle de un relevo con sus ítems por bloque. Con el cliente del usuario:
 * un relevo de otra organización no se lee (RLS) y sale como «no encontrado».
 */
export function HandoverDetail({ orgId, handoverId }: HandoverDetailProps) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [handover, setHandover] = useState<ShiftHandover | null>(null);
  const [items, setItems] = useState<HandoverItem[]>([]);
  const [author, setAuthor] = useState<string>(UNKNOWN_AUTHOR);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [{ data: h }, { data: its }, dir] = await Promise.all([
        supabase
          .from("shift_handovers")
          .select("id, org_id, department, shift_type, created_by, created_at")
          .eq("id", handoverId)
          .eq("org_id", orgId)
          .maybeSingle(),
        supabase
          .from("handover_items")
          .select("*")
          .eq("handover_id", handoverId)
          .eq("org_id", orgId)
          .order("created_at", { ascending: true }),
        fetchMemberDirectory(supabase, orgId),
      ]);
      if (!active) return;
      const found = (h as ShiftHandover | null) ?? null;
      setHandover(found);
      setItems(found && its ? (its as HandoverItem[]) : []);
      if (found) setAuthor(dir.get(found.created_by) ?? UNKNOWN_AUTHOR);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [orgId, handoverId, supabase]);

  if (loading) return <p className="text-gray-500">Cargando relevo...</p>;

  if (!handover) {
    return (
      <div className="space-y-4 text-center py-8">
        <p className="text-gray-700">Relevo no encontrado.</p>
        <Link href="/handover" className="text-orange-600 hover:underline">Volver a los relevos</Link>
      </div>
    );
  }

  const dept = DEPARTMENTS.find((d) => d.value === handover.department)?.label ?? handover.department;
  const shift = SHIFT_TYPES.find((s) => s.value === handover.shift_type)?.label ?? handover.shift_type;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/handover" className="text-sm text-orange-600 hover:underline">← Volver a los relevos</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">
          {dept} · {shift}
        </h1>
        <p className="text-gray-500 mt-1">
          <span>{author}</span>
          {" · "}
          <time dateTime={handover.created_at}>{formatDateTime(handover.created_at)}</time>
        </p>
      </div>

      {HANDOVER_BLOCKS.map((block) => {
        const blockItems = items.filter((i) => i.block === block.value);
        if (blockItems.length === 0) return null;
        const headingId = `handover-detail-${block.value}`;
        return (
          <section key={block.value} aria-labelledby={headingId} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 id={headingId} className="font-semibold text-gray-900 mb-3">{block.label}</h2>
            <ul className="space-y-2">
              {blockItems.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3">
                  <span className={`whitespace-pre-wrap ${item.resolved ? "text-gray-400 line-through" : "text-gray-800"}`}>
                    {item.content}
                  </span>
                  {item.resolved && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 whitespace-nowrap">Resuelto</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
