"use client";

import { useState, useEffect } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { MaintenanceTicket, TicketStatus } from "@/types";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@/types";

interface TicketListProps {
  orgId: string;
}

export function TicketList({ orgId }: TicketListProps) {
  const supabase = createBrowserClient();
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [filter, setFilter] = useState<TicketStatus | "todas">("abierto");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTickets();
  }, [orgId, filter]);

  async function loadTickets() {
    setLoading(true);
    let query = supabase
      .from("maintenance_tickets")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });

    if (filter !== "todas") {
      query = query.eq("status", filter);
    }

    const { data } = await query;
    if (data) setTickets(data as MaintenanceTicket[]);
    setLoading(false);
  }

  async function updateStatus(ticketId: string, newStatus: TicketStatus) {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === "cerrado") {
      updates.closed_by = userData.user.id;
      updates.closed_at = new Date().toISOString();
    }

    await supabase.from("maintenance_tickets").update(updates).eq("id", ticketId);

    await supabase.from("ticket_updates").insert({
      ticket_id: ticketId,
      status_to: newStatus,
      created_by: userData.user.id,
    });

    loadTickets();
  }

  function getPriorityColor(p: string) {
    return TICKET_PRIORITIES.find((tp) => tp.value === p)?.color || "gray";
  }

  function getStatusColor(s: string) {
    return TICKET_STATUSES.find((ts) => ts.value === s)?.color || "gray";
  }

  if (loading) return <p className="text-gray-500">Cargando partes...</p>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[{ value: "todas", label: "Todas" }, ...TICKET_STATUSES].map((s) => (
          <button
            key={s.value}
            onClick={() => setFilter(s.value as TicketStatus | "todas")}
            className={`px-3 py-1 text-sm rounded-full border ${
              filter === s.value
                ? "bg-orange-600 text-white border-orange-600"
                : "bg-white text-gray-600 border-gray-300 hover:border-orange-300"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {tickets.length === 0 && (
        <p className="text-gray-500 text-center py-8">
          No hay partes{filter !== "todas" ? ` ${TICKET_STATUSES.find((s) => s.value === filter)?.label.toLowerCase()}s` : ""}.
        </p>
      )}

      {tickets.map((ticket) => (
        <div key={ticket.id} className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="font-medium text-gray-900">{ticket.title}</h3>
              {ticket.description && (
                <p className="text-sm text-gray-500 mt-1">{ticket.description}</p>
              )}
            </div>
            <span
              className={`text-xs px-2 py-1 rounded-full font-medium bg-${getStatusColor(ticket.status)}-100 text-${getStatusColor(ticket.status)}-700`}
            >
              {TICKET_STATUSES.find((s) => s.value === ticket.status)?.label}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
            <span className={`text-${getPriorityColor(ticket.priority)}-600 font-medium`}>
              {TICKET_PRIORITIES.find((p) => p.value === ticket.priority)?.label}
            </span>
            <span>·</span>
            <span>{new Date(ticket.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>

          {ticket.status !== "cerrado" && (
            <div className="flex gap-2">
              {ticket.status === "abierto" && (
                <button
                  onClick={() => updateStatus(ticket.id, "en_curso")}
                  className="px-3 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200"
                >
                  En curso
                </button>
              )}
              {(ticket.status === "abierto" || ticket.status === "en_curso") && (
                <button
                  onClick={() => updateStatus(ticket.id, "cerrado")}
                  className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
                >
                  Cerrar
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}