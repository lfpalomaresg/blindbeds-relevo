"use client";

import { useAuth } from "@/hooks/useAuth";
import { TicketForm } from "@/components/tickets/TicketForm";

export default function NewTicketPage() {
  const { org, loading } = useAuth();

  if (loading) return <p className="text-gray-500">Cargando...</p>;
  if (!org) return <p className="text-red-600">No tienes una organización activa.</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Nuevo parte de avería</h1>
      <p className="text-gray-600">
        Escanea el QR del activo o crea un parte manual. La foto es obligatoria.
      </p>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <TicketForm orgId={org.id} />
      </div>
    </div>
  );
}