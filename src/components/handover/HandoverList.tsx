"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { UNKNOWN_AUTHOR, fetchAuthorEmails, formatDateTime } from "@/lib/members";
import type { Department, ShiftHandover } from "@/types";
import { DEPARTMENTS, SHIFT_TYPES } from "@/types";

interface HandoverListProps {
  orgId: string;
  /** Máximo de relevos a mostrar (los más recientes). */
  limit?: number;
}

/**
 * Últimos relevos de la organización. Consulta con el cliente del usuario:
 * RLS (handovers_select) limita a sus organizaciones activas.
 */
export function HandoverList({ orgId, limit = 50 }: HandoverListProps) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [department, setDepartment] = useState<Department | "todos">("todos");
  const [handovers, setHandovers] = useState<ShiftHandover[]>([]);
  const [authors, setAuthors] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      let query = supabase
        .from("shift_handovers")
        .select("id, org_id, department, shift_type, created_by, created_at")
        .eq("org_id", orgId);
      if (department !== "todos") query = query.eq("department", department);
      const { data } = await query.order("created_at", { ascending: false }).limit(limit);
      if (!active) return;
      const list = data ? (data as ShiftHandover[]) : [];
      // Solo los emails de los autores visibles (minimización).
      const emails = await fetchAuthorEmails(supabase, orgId, list.map((h) => h.created_by));
      if (!active) return;
      setHandovers(list);
      setAuthors(emails);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [orgId, department, limit, supabase]);

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="handover-list-department" className="block text-sm font-medium text-gray-700 mb-1">
          Departamento
        </label>
        <select
          id="handover-list-department"
          value={department}
          onChange={(e) => {
            setLoading(true);
            setDepartment(e.target.value as Department | "todos");
          }}
          className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-lg"
        >
          <option value="todos">Todos</option>
          {DEPARTMENTS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
      </div>

      {loading && <p className="text-gray-500">Cargando relevos...</p>}

      {!loading && handovers.length === 0 && (
        <p className="text-gray-500 text-center py-8">No hay relevos registrados.</p>
      )}

      {!loading &&
        handovers.map((h) => {
          const dept = DEPARTMENTS.find((d) => d.value === h.department)?.label ?? h.department;
          const shift = SHIFT_TYPES.find((s) => s.value === h.shift_type)?.label ?? h.shift_type;
          const title = `Relevo ${dept} · ${shift}`;
          return (
            <article key={h.id} aria-label={title} className="border border-gray-200 rounded-lg bg-white">
              <Link href={`/handover/${h.id}`} className="block p-4 hover:bg-orange-50 rounded-lg">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-gray-900">
                    {dept} · {shift}
                  </h3>
                  <time dateTime={h.created_at} className="text-xs text-gray-500 whitespace-nowrap">
                    {formatDateTime(h.created_at)}
                  </time>
                </div>
                <p className="text-sm text-gray-500 mt-1">{authors.get(h.created_by) ?? UNKNOWN_AUTHOR}</p>
              </Link>
            </article>
          );
        })}
    </div>
  );
}
