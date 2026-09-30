"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { TICKET_PRIORITIES } from "@/types";
import type { TicketPriority } from "@/types";
import { QRScanner } from "./QRScanner";

interface TicketFormProps {
  orgId: string;
  assetId?: string;
  onCreated?: () => void;
}

export function TicketForm({ orgId, assetId: initialAssetId, onCreated }: TicketFormProps) {
  const supabase = createBrowserClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [assetId, setAssetId] = useState<string | undefined>(initialAssetId);
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [scanning, setScanning] = useState(false);

  function handleQRScan(code: string) {
    setAssetId(code);
    setScanning(false);
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

    let photoPath: string | undefined;

    if (photo) {
      const ext = photo.name.split(".").pop();
      const filePath = `${orgId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("ticket-photos")
        .upload(filePath, photo);

      if (uploadError) {
        setError("Error al subir la foto: " + uploadError.message);
        setSaving(false);
        return;
      }
      photoPath = filePath;
    }

    const { error: insertError } = await supabase.from("maintenance_tickets").insert({
      org_id: orgId,
      asset_id: assetId || null,
      title,
      description: description || null,
      priority,
      status: "abierto",
      photo_path: photoPath || null,
      created_by: userData.user.id,
    });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setDone(true);
    onCreated?.();
  }

  if (done) {
    return (
      <div className="text-center space-y-4 py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <span className="text-3xl">✅</span>
        </div>
        <h2 className="text-xl font-semibold">Parte de avería creado</h2>
        <p className="text-gray-600">Mantenimiento ha sido notificado.</p>
        <button
          onClick={() => {
            setDone(false);
            setTitle("");
            setDescription("");
            setPhoto(null);
            setAssetId(undefined);
          }}
          className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
        >
          Nuevo parte
        </button>
      </div>
    );
  }

  return (
    <>
      {scanning && (
        <QRScanner onScan={handleQRScan} onClose={() => setScanning(false)} />
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {assetId && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex justify-between items-center">
            <span className="text-sm text-blue-700">Activo escaneado: <code className="font-mono">{assetId}</code></span>
            <button
              type="button"
              onClick={() => setAssetId(undefined)}
              className="text-xs text-blue-500 hover:text-blue-700"
            >
              Quitar
            </button>
          </div>
        )}

        {!assetId && (
          <button
            type="button"
            onClick={() => setScanning(true)}
            className="w-full py-3 px-4 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-orange-400 hover:text-orange-600 flex items-center justify-center gap-2"
          >
            <span>📷</span> Escanear QR del activo
          </button>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="Ej: Grifo gotea en habitación 304"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Detalles adicionales..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Prioridad</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TicketPriority)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          >
            {TICKET_PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Foto (obligatoria)</label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setPhoto(e.target.files?.[0] || null)}
            className="w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
          />
          {photo && (
            <p className="text-xs text-gray-500 mt-1">📸 {photo.name}</p>
          )}
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-3 px-4 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 font-medium"
        >
          {saving ? "Guardando..." : "Crear parte de avería"}
        </button>
      </form>
    </>
  );
}