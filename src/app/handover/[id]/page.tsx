"use client";

import { use } from "react";
import { useAuth } from "@/hooks/useAuth";
import { HandoverDetail } from "@/components/handover/HandoverDetail";

export default function HandoverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org, loading } = useAuth();

  if (loading) return <p className="text-gray-500">Cargando...</p>;
  if (!org) return <p className="text-red-600">No tienes una organización activa.</p>;

  return <HandoverDetail orgId={org.id} handoverId={id} />;
}
