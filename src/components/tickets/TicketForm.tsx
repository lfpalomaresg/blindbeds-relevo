"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  LIMITS,
  PHOTO_SNIFF_BYTES,
  buildPhotoPath,
  photoBytesMatchType,
  validatePhoto,
  validateTicketInput,
} from "@/lib/validation";
import { TICKET_PHOTO_UPLOAD_ERROR, createTicketErrorMessage } from "@/lib/ticket-errors";
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

/** Crea/revoca la URL de vista previa; en jsdom URL.createObjectURL no existe. */
function makePreviewUrl(file: File | null): string | null {
  if (!file || typeof URL.createObjectURL !== "function") return null;
  return URL.createObjectURL(file);
}

export function TicketForm({ orgId, assetId: initialAssetId, onCreated }: TicketFormProps) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [title, setTitle] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [asset, setAsset] = useState<SelectedAsset | null>(initialAssetId ? { id: initialAssetId } : null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState("");

  // El QR (o el código impreso bajo él) es el texto de ticket_assets.qr_code;
  // el parte necesita el id (uuid). Se busca solo dentro de la organización.
  async function lookupAsset(code: string, notFoundMessage: string) {
    setError("");
    const { data, error: lookupError } = await supabase
      .from("ticket_assets")
      .select("id, name")
      .eq("org_id", orgId)
      .eq("qr_code", code)
      .maybeSingle();

    if (lookupError || !data) {
      setAsset(null);
      setError(notFoundMessage);
      return;
    }
    setAsset({ id: data.id as string, name: data.name as string });
    setManualCode("");
  }

  async function handleQRScan(code: string) {
    setScanning(false);
    await lookupAsset(code, "Activo no reconocido. Vuelve a escanear el QR o crea el parte sin activo.");
  }

  // Vista previa local: se revoca la anterior para no filtrar blobs.
  function handlePhotoChange(file: File | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPhoto(file);
    setPreviewUrl(makePreviewUrl(file));
  }

  function clearPhoto() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPhoto(null);
    setPreviewUrl(null);
  }

  useEffect(() => {
    return () => {
      if (previewUrl && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  async function handleManualCode() {
    const code = manualCode.trim();
    if (!code) {
      setError("Escribe el código del activo (está impreso bajo el QR).");
      return;
    }
    await lookupAsset(code, "Código no encontrado. Revísalo o crea el parte sin activo.");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const validated = validateTicketInput({
      title,
      description,
      priority,
      assetId: asset?.id ?? null,
      roomNumber,
    });
    if (!validated.ok) {
      setError(validated.error);
      return;
    }

    const photoCheck = photo ? validatePhoto(photo) : null;
    if (photoCheck && !photoCheck.ok) {
      setError(photoCheck.error);
      return;
    }
    if (photo && photoCheck?.ok) {
      const head = new Uint8Array(await photo.slice(0, PHOTO_SNIFF_BYTES).arrayBuffer());
      if (!photoBytesMatchType(photoCheck.value.contentType, head)) {
        setError("Ese fichero no es una foto válida. Usa una foto JPEG, PNG o WebP.");
        return;
      }
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
        setError(TICKET_PHOTO_UPLOAD_ERROR);
        setSaving(false);
        return;
      }
      photoPath = filePath;
    }

    // Migración 000013: los partes solo se crean por RPC. La base de datos fija
    // created_by (la sesión), status 'abierto' y deja el cierre vacío.
    const { error: insertError } = await supabase.rpc("create_ticket", {
      p_org_id: orgId,
      p_asset_id: validated.value.assetId,
      p_room_number: validated.value.roomNumber,
      p_title: validated.value.title,
      p_description: validated.value.description,
      p_priority: validated.value.priority,
      p_photo_path: photoPath,
    });

    if (insertError) {
      // La foto NO se borra aquí: el error puede ser ambiguo (el parte se creó y
      // se perdió la respuesta). Si quedó huérfana, el barrido del servidor la
      // borra a las 24 h (scripts/purge-ticket-photos.mjs).
      setError(createTicketErrorMessage(insertError));
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
            setRoomNumber("");
            setDescription("");
            clearPhoto();
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

        {!asset && (
          <div>
            <label htmlFor="ticket-asset-code" className="block text-sm font-medium text-gray-700 mb-1">
              Código del activo <span className="text-gray-400 font-normal">— si no puedes escanear</span>
            </label>
            <div className="flex gap-2">
              <input
                id="ticket-asset-code"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleManualCode();
                  }
                }}
                maxLength={100}
                autoCapitalize="characters"
                placeholder="Código impreso bajo el QR"
                className="flex-1 min-w-0 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
              <button
                type="button"
                onClick={() => void handleManualCode()}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:border-orange-400 hover:text-orange-600"
              >
                Buscar activo
              </button>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="ticket-room" className="block text-sm font-medium text-gray-700 mb-1">
            Habitación o zona
          </label>
          <input
            id="ticket-room"
            value={roomNumber}
            onChange={(e) => setRoomNumber(e.target.value)}
            maxLength={LIMITS.roomNumber}
            inputMode="text"
            placeholder="Ej: 304 o Piscina"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            Nº de habitación o zona. El activo y el QR son opcionales.
          </p>
        </div>

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
          <span className="block text-sm font-medium text-gray-700 mb-1">Foto de la avería</span>

          <div className="grid grid-cols-2 gap-2">
            <input
              id="ticket-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(e) => handlePhotoChange(e.target.files?.[0] || null)}
              className="sr-only"
            />
            <label
              htmlFor="ticket-photo"
              className="flex items-center justify-center gap-2 py-3 px-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-orange-400 hover:text-orange-600 cursor-pointer text-sm text-center"
            >
              <span>📷</span> Hacer foto de la avería
            </label>

            <input
              id="ticket-photo-gallery"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => handlePhotoChange(e.target.files?.[0] || null)}
              className="sr-only"
            />
            <label
              htmlFor="ticket-photo-gallery"
              className="flex items-center justify-center gap-2 py-3 px-3 border border-gray-300 rounded-lg text-gray-600 hover:border-orange-400 hover:text-orange-600 cursor-pointer text-sm text-center"
            >
              <span>🖼️</span> Elegir de la galería
            </label>
          </div>

          <p className="text-xs text-gray-400 mt-1">
            JPEG, PNG o WebP, máximo 10 MB. No fotografíes huéspedes ni documentos.
          </p>

          {previewUrl && (
            <div className="mt-3 flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local, no pasa por el optimizador */}
              <img
                src={previewUrl}
                alt="Vista previa de la foto"
                className="h-24 w-auto rounded-lg border border-gray-200"
              />
              <div className="text-xs text-gray-500">
                <p className="wrap-anywhere">{photo?.name}</p>
                <button
                  type="button"
                  onClick={clearPhoto}
                  className="mt-1 text-red-600 hover:text-red-700"
                >
                  Quitar foto
                </button>
              </div>
            </div>
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
