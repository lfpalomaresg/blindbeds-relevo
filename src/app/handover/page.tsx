"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { HandoverList } from "@/components/handover/HandoverList";

export default function HandoversPage() {
  const { org, loading } = useAuth();

  if (loading) return <p className="text-gray-500">Cargando...</p>;
  if (!org) return <p className="text-red-600">No tienes una organización activa.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Relevos de turno</h1>
        <Link href="/handover/new" className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm">
          Nuevo relevo
        </Link>
      </div>
      <HandoverList orgId={org.id} />
    </div>
  );
}
