"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { UNKNOWN_AUTHOR, fetchTicketAuthorEmails, formatDateTime } from "@/lib/members";
import type { MaintenanceTicket, TicketStatus, TicketUpdate } from "@/types";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@/types";
import { TicketPhoto } from "./TicketPhoto";

interface TicketDetailProps {
  orgId: string;
  ticketId: string;
}

/** Mismas transiciones que la lista: solo se ofrecen las que el RPC acepta. */
const NEXT_ACTIONS: Record<TicketStatus, { to: TicketStatus; label: string }[]> = {
  abierto: [
    { to: "en_curso", label: "Poner en curso" },
    { to: "cerrado", label: "Cerrar parte" },
  ],
  en_curso: [{ to: "cerrado", label: "Cerrar parte" }],
  cerrado: [],
};

/**
 * Detalle de un parte: datos, foto a tamaño completo e historial de estados.
 * Con el cliente del usuario: un parte de otra organización no se lee (RLS) y
 * sale como «no encontrado».
 */
export function TicketDetail({ orgId, ticketId }: TicketDetailProps) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [ticket, setTicket] = useState<MaintenanceTicket | null>(null);
  const [updates, setUpdates] = useState<TicketUpdate[]>([]);
  const [authors, setAuthors] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [{ data: t }, { data: u }] = await Promise.all([
        supabase
          .from("maintenance_tickets")
          .select("*")
          .eq("id", ticketId)
          .eq("org_id", orgId)
          .maybeSingle(),
        supabase
          .from("ticket_updates")
          .select("*")
          .eq("ticket_id", ticketId)
          .order("created_at", { ascending: true }),
      ]);

      const found = (t as MaintenanceTicket | null) ?? null;
      const list = found && u ? (u as TicketUpdate[]) : [];
      const dir = found
        ? await fetchTicketAuthorEmails(supabase, orgId, [found.created_by, ...list.map((i) => i.created_by)])
        : new Map<string, string>();
      if (!active) return;

      setTicket(found);
      setUpdates(list);
      setAuthors(dir);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [orgId, ticketId, supabase, tick]);

  async function changeStatus(from: TicketStatus, to: TicketStatus) {
    setError("");
    setSaving(true);
    const { data: changed, error: rpcError } = await supabase.rpc("change_ticket_status", {
      p_ticket_id: ticketId,
      p_from: from,
      p_to: to,
    });
    setSaving(false);

    if (rpcError) {
      setError("No se pudo cambiar el estado: " + rpcError.message);
      return;
    }
    if (changed !== true) {
      setError("El parte cambió de estado en otro dispositivo. Se ha recargado.");
    }
    setTick((n) => n + 1);
  }

  if (loading) return <p className="text-gray-500">Cargando parte...</p>;

  if (!ticket) {
    return (
      <div className="space-y-4 text-center py-8">
        <p className="text-gray-700">Parte no encontrado.</p>
        <Link href="/dashboard" className="text-orange-600 hover:underline">Volver al panel</Link>
      </div>
    );
  }

  const priority = TICKET_PRIORITIES.find((p) => p.value === ticket.priority);
  const status = TICKET_STATUSES.find((s) => s.value === ticket.status);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-sm text-orange-600 hover:underline">← Volver al panel</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2 wrap-anywhere">{ticket.title}</h1>
        <p className="text-gray-500 mt-1 text-sm">
          {ticket.room_number && <span>Habitación / zona: {ticket.room_number} · </span>}
          <span className={`text-${priority?.color ?? "gray"}-600 font-medium`}>{priority?.label ?? ticket.priority}</span>
          {" · "}
          <span>{status?.label ?? ticket.status}</span>
        </p>
        <p className="text-gray-500 text-xs mt-1">
          Creado por {authors.get(ticket.created_by) ?? UNKNOWN_AUTHOR} el{" "}
          <time dateTime={ticket.created_at}>{formatDateTime(ticket.created_at)}</time>
        </p>
      </div>

      {ticket.description && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-1">Descripción</h2>
          <p className="text-gray-700 whitespace-pre-wrap wrap-anywhere">{ticket.description}</p>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <h2 className="text-sm font-medium text-gray-700 mb-2">Foto</h2>
        {ticket.photo_path ? (
          <TicketPhoto path={ticket.photo_path} />
        ) : (
          <p className="text-sm text-gray-400">Este parte no tiene foto.</p>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <h2 className="text-sm font-medium text-gray-700 mb-2">Historial</h2>
        <ol className="space-y-2">
          <li className="text-sm text-gray-600">
            <span className="font-medium">Abierto</span>{" "}
            <span className="text-xs text-gray-400">
              · {formatDateTime(ticket.created_at)} · {authors.get(ticket.created_by) ?? UNKNOWN_AUTHOR}
            </span>
          </li>
          {updates.map((u) => (
            <li key={u.id} className="text-sm text-gray-600">
              <span className="font-medium">
                {TICKET_STATUSES.find((s) => s.value === u.status_to)?.label ?? u.status_to}
              </span>{" "}
              <span className="text-xs text-gray-400">
                · {formatDateTime(u.created_at)} · {authors.get(u.created_by) ?? UNKNOWN_AUTHOR}
              </span>
              {u.comment && <p className="text-xs text-gray-500 mt-0.5 wrap-anywhere">{u.comment}</p>}
            </li>
          ))}
        </ol>
      </div>

      {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}

      {NEXT_ACTIONS[ticket.status].length > 0 && (
        <div className="flex gap-2">
          {NEXT_ACTIONS[ticket.status].map((action) => (
            <button
              key={action.to}
              onClick={() => void changeStatus(ticket.status, action.to)}
              disabled={saving}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
