"use client";

import { useAuth } from "@/hooks/useAuth";
import { PendingItems } from "@/components/handover/PendingItems";
import { TicketList } from "@/components/tickets/TicketList";

export default function DashboardPage() {
  const { org, loading } = useAuth();

  if (loading) return <p className="text-gray-500 text-center py-12">Cargando...</p>;
  if (!org) return <p className="text-red-600 text-center py-12">No tienes una organización activa. Contacta con el operador.</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{org.name}</h1>
        <p className="text-gray-500 mt-1">Resumen operativo del día</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <a
          href="/handover/new"
          className="block p-6 bg-white rounded-xl shadow-sm border border-gray-200 hover:border-orange-300 transition-colors"
        >
          <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center mb-3">
            <span className="text-xl">🔄</span>
          </div>
          <h2 className="font-semibold text-gray-900">Relevo de turno</h2>
          <p className="text-sm text-gray-500 mt-1">Registra el traspaso de tu turno en 2 minutos</p>
        </a>

        <a
          href="/tickets/new"
          className="block p-6 bg-white rounded-xl shadow-sm border border-gray-200 hover:border-orange-300 transition-colors"
        >
          <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center mb-3">
            <span className="text-xl">🔧</span>
          </div>
          <h2 className="font-semibold text-gray-900">Parte de avería</h2>
          <p className="text-sm text-gray-500 mt-1">Reporta una avería con foto y prioridad</p>
        </a>
      </div>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Pendientes sin resolver</h2>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <PendingItems orgId={org.id} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Partes de avería activos</h2>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <TicketList orgId={org.id} />
        </div>
      </section>
    </div>
  );
}