"use client";

import { useAuth } from "@/hooks/useAuth";
import { HandoverForm } from "@/components/handover/HandoverForm";

export default function NewHandoverPage() {
  const { org, loading } = useAuth();

  if (loading) return <p className="text-gray-500">Cargando...</p>;
  if (!org) return <p className="text-red-600">No tienes una organización activa.</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Nuevo relevo de turno</h1>
      <p className="text-gray-600">
        Documenta el traspaso de tu turno para que el siguiente sepa exactamente qué está pasando.
      </p>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <HandoverForm orgId={org.id} />
      </div>
    </div>
  );
}