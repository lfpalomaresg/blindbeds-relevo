"use client";

import { useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { LIMITS, buildPhotoPath, validatePhoto, validateTicketInput } from "@/lib/validation";
import { TICKET_PRIORITIES } from "@/types";
import type { TicketPriority } from "@/types";
import { QRScanner } from "./QRScanner";

interface TicketFormProps {
  orgId: string;
  /** id (uuid) de ticket_assets preseleccionado. */
  assetId?: string;
  onCreated?: () => void;
}

interface SelectedAsset {
  id: string;
  name?: string;
}

export function TicketForm({ orgId, assetId: initialAssetId, onCreated }: TicketFormProps) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [asset, setAsset] = useState<SelectedAsset | null>(initialAssetId ? { id: initialAssetId } : null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [scanning, setScanning] = useState(false);

  // El QR lleva el texto de ticket_assets.qr_code; el parte necesita el id (uuid).
  async function handleQRScan(code: string) {
    setScanning(false);
    setError("");
    const { data, error: lookupError } = await supabase
      .from("ticket_assets")
      .select("id, name")
      .eq("org_id", orgId)
      .eq("qr_code", code)
      .maybeSingle();

    if (lookupError || !data) {
      setAsset(null);
      setError("Activo no reconocido. Vuelve a escanear el QR o crea el parte sin activo.");
      return;
    }
    setAsset({ id: data.id as string, name: data.name as string });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const validated = validateTicketInput({ title, description, priority, assetId: asset?.id ?? null });
    if (!validated.ok) {
      setError(validated.error);
      return;
    }

    const photoCheck = photo ? validatePhoto(photo) : null;
    if (photoCheck && !photoCheck.ok) {
      setError(photoCheck.error);
      return;
    }

    setSaving(true);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setError("No hay sesión activa");
      setSaving(false);
      return;
    }

    let photoPath: string | null = null;

    if (photo && photoCheck?.ok) {
      const filePath = buildPhotoPath(orgId, photoCheck.value.ext, crypto.randomUUID());
      const { error: uploadError } = await supabase.storage
        .from("ticket-photos")
        .upload(filePath, photo, { contentType: photoCheck.value.contentType, upsert: false });

      if (uploadError) {
        setError("Error al subir la foto: " + uploadError.message);
        setSaving(false);
        return;
      }
      photoPath = filePath;
    }

    const { error: insertError } = await supabase.from("maintenance_tickets").insert({
      org_id: orgId,
      asset_id: validated.value.assetId,
      title: validated.value.title,
      description: validated.value.description,
      priority: validated.value.priority,
      status: "abierto",
      photo_path: photoPath,
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
        <p className="text-gray-600">Queda abierto y visible en el panel de inicio.</p>
        <button
          onClick={() => {
            setDone(false);
            setTitle("");
            setDescription("");
            setPhoto(null);
            setAsset(null);
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
        {asset && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex justify-between items-center">
            <span className="text-sm text-blue-700">
              Activo: <strong>{asset.name ?? asset.id}</strong>
            </span>
            <button
              type="button"
              onClick={() => setAsset(null)}
              className="text-xs text-blue-500 hover:text-blue-700"
            >
              Quitar
            </button>
          </div>
        )}

        {!asset && (
          <button
            type="button"
            onClick={() => setScanning(true)}
            className="w-full py-3 px-4 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-orange-400 hover:text-orange-600 flex items-center justify-center gap-2"
          >
            <span>📷</span> Escanear QR del activo
          </button>
        )}

        <div>
          <label htmlFor="ticket-title" className="block text-sm font-medium text-gray-700 mb-1">Título</label>
          <input
            id="ticket-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={LIMITS.ticketTitle}
            placeholder="Ej: Grifo gotea en habitación 304"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          />
        </div>

        <div>
          <label htmlFor="ticket-description" className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
          <textarea
            id="ticket-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={LIMITS.ticketDescription}
            placeholder="Detalles adicionales..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          />
        </div>

        <div>
          <label htmlFor="ticket-priority" className="block text-sm font-medium text-gray-700 mb-1">Prioridad</label>
          <select
            id="ticket-priority"
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
          <label htmlFor="ticket-photo" className="block text-sm font-medium text-gray-700 mb-1">Foto</label>
          <input
            id="ticket-photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(e) => setPhoto(e.target.files?.[0] || null)}
            className="w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
          />
          <p className="text-xs text-gray-400 mt-1">JPEG, PNG o WebP, máximo 10 MB.</p>
          {photo && (
            <p className="text-xs text-gray-500 mt-1">📸 {photo.name}</p>
          )}
        </div>

        {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}

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
