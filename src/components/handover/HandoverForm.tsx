"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { createHandoverErrorMessage } from "@/lib/handover-errors";
import { LIMITS, validateHandoverInput } from "@/lib/validation";
import { FREE_TEXT_NOTICE } from "@/lib/privacy";
import type { HandoverItem, HandoverBlock, Department, ShiftType } from "@/types";
import { DEPARTMENTS, SHIFT_TYPES, HANDOVER_BLOCKS } from "@/types";

/** UUID v4 criptografico para la clave de idempotencia (impredecible). */
function nuevaClaveIdempotencia(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  // Fallback criptografico si el entorno no expone randomUUID.
  const bytes = c.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

interface HandoverFormProps {
  orgId: string;
}

const EMPTY_ITEMS: Record<HandoverBlock, string> = {
  pendientes: "",
  vips: "",
  incidencias: "",
  avisos: "",
};

export function HandoverForm({ orgId }: HandoverFormProps) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [department, setDepartment] = useState<Department>("recepcion");
  const [shiftType, setShiftType] = useState<ShiftType>("manana");
  const [items, setItems] = useState<Record<HandoverBlock, string>>(EMPTY_ITEMS);
  const [pendingItems, setPendingItems] = useState<HandoverItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const idempotencyKey = useRef<{ key: string; content: string }>({ key: nuevaClaveIdempotencia(), content: "" });
  // Guarda sincrona: evita que dos envios a la vez se intercalen y creen dos relevos.
  const enviando = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabase
        .from("handover_items")
        .select("*")
        .eq("org_id", orgId)
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(10);
      if (active && data) setPendingItems(data as HandoverItem[]);
    })();
    return () => { active = false; };
  }, [orgId, supabase]);

  function updateBlock(block: HandoverBlock, value: string) {
    setItems((prev) => ({ ...prev, [block]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (enviando.current) return;  // ya hay un envio en curso: se ignora el segundo
    setError("");

    // Validar antes de tocar la red: sin bloques, catálogo o límites incorrectos no hay insert.
    const validated = validateHandoverInput({ department, shiftType, items });
    if (!validated.ok) {
      setError(validated.error);
      return;
    }

    // Clave atada al contenido, capturada ANTES de cualquier await. Con la guarda
    // sincrona, dos envios simultaneos no pueden intercalarse ni rotar la clave.
    // Normalizado igual que lo que se envia (trim + bloques con contenido).
    const contenido = JSON.stringify({
      department: validated.value.department,
      shiftType: validated.value.shiftType,
      items: validated.value.items,
    });
    if (idempotencyKey.current.content !== contenido) {
      idempotencyKey.current = { key: nuevaClaveIdempotencia(), content: contenido };
    }
    const clave = idempotencyKey.current.key;
    enviando.current = true;
    setSaving(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError("No hay sesión activa");
        return;
      }

      // Cabecera + items en una sola transacción (000006). Desde 000014 es security
      // definer: la base comprueba la membresía y fija el autor.
      const { error: rpcError } = await supabase.rpc("create_handover_idempotent", {
        p_org_id: orgId,
        p_department: validated.value.department,
        p_shift_type: validated.value.shiftType,
        p_items: validated.value.items.map((item) => ({ block: item.block, content: item.content })),
        p_idempotency_key: clave,
      });

      if (rpcError) {
        setError(createHandoverErrorMessage(rpcError));
        return;
      }

      // Éxito confirmado: rota la clave (una operación nueva no es un reintento).
      idempotencyKey.current = { key: nuevaClaveIdempotencia(), content: "" };
      setDone(true);
    } finally {
      enviando.current = false;
      setSaving(false);
    }
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
          documentado. Sus puntos quedan como pendientes en el panel de inicio hasta que alguien los resuelva.
        </p>
        <button
          onClick={() => {
            setDone(false);
            setItems(EMPTY_ITEMS);
            idempotencyKey.current = { key: nuevaClaveIdempotencia(), content: "" };
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
          <label htmlFor="handover-department" className="block text-sm font-medium text-gray-700 mb-1">Departamento</label>
          <select
            id="handover-department"
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
          <label htmlFor="handover-shift" className="block text-sm font-medium text-gray-700 mb-1">Turno</label>
          <select
            id="handover-shift"
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
              <li key={item.id} className="flex justify-between gap-2">
                <span className="min-w-0 wrap-anywhere">[{HANDOVER_BLOCKS.find((b) => b.value === item.block)?.label}] {item.content}</span>
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
          <label htmlFor={`handover-block-${block.value}`} className="block text-sm font-medium text-gray-700 mb-1">
            {block.label}
            <span className="text-gray-400 font-normal ml-1">— {block.description}</span>
          </label>
          <textarea
            id={`handover-block-${block.value}`}
            value={items[block.value]}
            onChange={(e) => updateBlock(block.value, e.target.value)}
            rows={3}
            maxLength={LIMITS.handoverContent}
            aria-describedby={`handover-block-${block.value}-notice`}
            placeholder={`Escribe aquí ${block.description.toLowerCase()}...`}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          />
          <p id={`handover-block-${block.value}-notice`} className="text-xs text-amber-700 mt-1">
            {FREE_TEXT_NOTICE}
          </p>
        </div>
      ))}

      {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}

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
