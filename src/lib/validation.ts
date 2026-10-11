/**
 * Validación de entrada de los formularios de Relevo.
 *
 * Funciones puras: reciben lo que el usuario escribió y devuelven o bien el
 * valor normalizado listo para insertar, o bien un mensaje de error en
 * castellano para mostrar en el formulario. La base de datos vuelve a validar
 * (CHECK constraints + RLS); esto evita viajes inútiles y mensajes crípticos.
 */
import {
  DEPARTMENTS,
  HANDOVER_BLOCKS,
  SHIFT_TYPES,
  TICKET_PRIORITIES,
  type Department,
  type HandoverBlock,
  type ShiftType,
  type TicketPriority,
} from "@/types";

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export const LIMITS = {
  /** Caracteres por bloque del relevo. */
  handoverContent: 2000,
  ticketTitle: 120,
  ticketDescription: 2000,
  /** Igual que file_size_limit del bucket ticket-photos en la migración. */
  photoBytes: 10 * 1024 * 1024,
} as const;

/** MIME → extensión. Igual que allowed_mime_types del bucket ticket-photos. */
export const ALLOWED_PHOTO_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

const DEPARTMENT_VALUES = new Set<string>(DEPARTMENTS.map((d) => d.value));
const SHIFT_VALUES = new Set<string>(SHIFT_TYPES.map((s) => s.value));
const PRIORITY_VALUES = new Set<string>(TICKET_PRIORITIES.map((p) => p.value));

// ─── Handover ───────────────────────────────────────────────────────────────

export interface HandoverInput {
  department: string;
  shiftType: string;
  items: Record<string, string>;
}

export interface HandoverValue {
  department: Department;
  shiftType: ShiftType;
  items: { block: HandoverBlock; content: string }[];
}

export function validateHandoverInput(input: HandoverInput): Validation<HandoverValue> {
  if (!DEPARTMENT_VALUES.has(input.department)) {
    return { ok: false, error: "Departamento no válido." };
  }
  if (!SHIFT_VALUES.has(input.shiftType)) {
    return { ok: false, error: "Turno no válido." };
  }

  const items: HandoverValue["items"] = [];
  // Se recorre el catálogo, no las claves recibidas: cualquier clave extra se ignora.
  for (const block of HANDOVER_BLOCKS) {
    const raw = Object.prototype.hasOwnProperty.call(input.items, block.value) ? input.items[block.value] : "";
    const content = typeof raw === "string" ? raw.trim() : "";
    if (!content) continue;
    if (content.length > LIMITS.handoverContent) {
      return { ok: false, error: `${block.label}: máximo ${LIMITS.handoverContent} caracteres.` };
    }
    items.push({ block: block.value, content });
  }

  if (items.length === 0) {
    return { ok: false, error: "Escribe al menos un bloque antes de registrar el relevo." };
  }

  return {
    ok: true,
    value: { department: input.department as Department, shiftType: input.shiftType as ShiftType, items },
  };
}

// ─── Parte de avería ────────────────────────────────────────────────────────

export interface TicketInput {
  title: string;
  description: string;
  priority: string;
  assetId?: string | null;
}

export interface TicketValue {
  title: string;
  description: string | null;
  priority: TicketPriority;
  /** id (uuid) de ticket_assets, nunca el texto del QR. */
  assetId: string | null;
}

export function validateTicketInput(input: TicketInput): Validation<TicketValue> {
  const title = (input.title ?? "").trim();
  if (!title) return { ok: false, error: "El título es obligatorio." };
  if (title.length > LIMITS.ticketTitle) {
    return { ok: false, error: `Título: máximo ${LIMITS.ticketTitle} caracteres.` };
  }

  const description = (input.description ?? "").trim();
  if (description.length > LIMITS.ticketDescription) {
    return { ok: false, error: `Descripción: máximo ${LIMITS.ticketDescription} caracteres.` };
  }

  if (!PRIORITY_VALUES.has(input.priority)) {
    return { ok: false, error: "Prioridad no válida." };
  }

  let assetId: string | null = null;
  if (input.assetId) {
    if (!isUuid(input.assetId)) {
      return { ok: false, error: "Activo no reconocido. Vuelve a escanear el QR." };
    }
    assetId = input.assetId;
  }

  return {
    ok: true,
    value: { title, description: description || null, priority: input.priority as TicketPriority, assetId },
  };
}

// ─── Foto ───────────────────────────────────────────────────────────────────

/** Subconjunto de File suficiente para validar sin DOM. */
export interface PhotoLike {
  size: number;
  type: string;
  name?: string;
}

export function validatePhoto(photo: PhotoLike): Validation<{ ext: string; contentType: string }> {
  const ext = ALLOWED_PHOTO_TYPES[photo.type];
  if (!ext) {
    return { ok: false, error: "Formato no admitido. Usa una foto JPEG, PNG o WebP." };
  }
  if (!Number.isFinite(photo.size) || photo.size <= 0) {
    return { ok: false, error: "La foto está vacía." };
  }
  if (photo.size > LIMITS.photoBytes) {
    return { ok: false, error: "La foto supera el máximo de 10 MB." };
  }
  return { ok: true, value: { ext, contentType: photo.type } };
}

/**
 * Ruta dentro del bucket: `<org_id>/<uuid>.<ext>`. Ambos identificadores deben
 * ser UUID y la extensión venir del catálogo, así no hay forma de salir de la
 * carpeta de la organización.
 */
export function buildPhotoPath(orgId: string, ext: string, fileId: string): string {
  if (!isUuid(orgId)) throw new Error("orgId must be a UUID");
  if (!isUuid(fileId)) throw new Error("fileId must be a UUID");
  if (!Object.values(ALLOWED_PHOTO_TYPES).includes(ext)) throw new Error("unsupported extension");
  return `${orgId}/${fileId}.${ext}`;
}
