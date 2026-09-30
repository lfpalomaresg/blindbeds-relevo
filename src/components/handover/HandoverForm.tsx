"use client";

import { useState, useEffect } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { HandoverItem, HandoverBlock, Department, ShiftType } from "@/types";
import { DEPARTMENTS, SHIFT_TYPES, HANDOVER_BLOCKS } from "@/types";

interface HandoverFormProps {
  orgId: string;
}

export function HandoverForm({ orgId }: HandoverFormProps) {
  const supabase = createBrowserClient();
  const [department, setDepartment] = useState<Department>("recepcion");
  const [shiftType, setShiftType] = useState<ShiftType>("manana");
  const [items, setItems] = useState<Record<HandoverBlock, string>>({
    pendientes: "",
    vips: "",
    incidencias: "",
    avisos: "",
  });
  const [pendingItems, setPendingItems] = useState<HandoverItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    loadPendingItems();
  }, []);

  async function loadPendingItems() {
    const { data } = await supabase
      .from("handover_items")
      .select("*")
      .eq("org_id", orgId)
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(10);
    if (data) setPendingItems(data as HandoverItem[]);
  }

  function updateBlock(block: HandoverBlock, value: string) {
    setItems((prev) => ({ ...prev, [block]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setError("No hay sesión activa");
      setSaving(false);
      return;
    }

    const { data: handover, error: hError } = await supabase
      .from("shift_handovers")
      .insert({
        org_id: orgId,
        department,
        shift_type: shiftType,
        created_by: userData.user.id,
      })
      .select("id")
      .single();

    if (hError || !handover) {
      setError(hError?.message || "Error al crear el handover");
      setSaving(false);
      return;
    }

    const itemRows = HANDOVER_BLOCKS
      .filter((b) => items[b.value].trim())
      .map((b) => ({
        handover_id: handover.id,
        org_id: orgId,
        block: b.value,
        content: items[b.value].trim(),
      }));

    if (itemRows.length > 0) {
      const { error: iError } = await supabase.from("handover_items").insert(itemRows);
      if (iError) {
        setError(iError.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setDone(true);
  }

  if (done) {
    return (
      <div className="text-center space-y-4 py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <span className="text-3xl">✅</span>
        </div>
        <h2 className="text-xl font-semibold">Relevo registrado</h2>
        <p className="text-gray-600">
          El turno de <strong>{SHIFT_TYPES.find((s) => s.value === shiftType)?.label}</strong> en{" "}
          <strong>{DEPARTMENTS.find((d) => d.value === department)?.label}</strong> ha quedado
          documentado. El siguiente turno lo verá al entrar.
        </p>
        <button
          onClick={() => {
            setDone(false);
            setItems({ pendientes: "", vips: "", incidencias: "", avisos: "" });
          }}
          className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
        >
          Nuevo relevo
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Departamento</label>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value as Department)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          >
            {DEPARTMENTS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Turno</label>
          <select
            value={shiftType}
            onChange={(e) => setShiftType(e.target.value as ShiftType)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          >
            {SHIFT_TYPES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {pendingItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 className="font-medium text-amber-800 mb-2">
            Pendientes sin resolver ({pendingItems.length})
          </h3>
          <ul className="space-y-1 text-sm text-amber-700">
            {pendingItems.map((item) => (
              <li key={item.id} className="flex justify-between">
                <span>[{HANDOVER_BLOCKS.find((b) => b.value === item.block)?.label}] {item.content}</span>
                <span className="text-amber-500 text-xs">
                  {new Date(item.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {HANDOVER_BLOCKS.map((block) => (
        <div key={block.value}>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {block.label}
            <span className="text-gray-400 font-normal ml-1">— {block.description}</span>
          </label>
          <textarea
            value={items[block.value]}
            onChange={(e) => updateBlock(block.value, e.target.value)}
            rows={3}
            placeholder={`Escribe aquí ${block.description.toLowerCase()}...`}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          />
        </div>
      ))}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="w-full py-3 px-4 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 font-medium"
      >
        {saving ? "Guardando..." : "Registrar relevo"}
      </button>
    </form>
  );
}