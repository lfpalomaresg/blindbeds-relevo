import { describe, expect, it } from "vitest";
import {
  ALLOWED_PHOTO_TYPES,
  LIMITS,
  buildPhotoPath,
  isUuid,
  validateHandoverInput,
  photoBytesMatchType,
  validatePhoto,
  validateTicketInput,
} from "@/lib/validation";

const ORG = "00000000-0000-0000-0000-00000000000a";
const EMPTY_BLOCKS = { pendientes: "", vips: "", incidencias: "", avisos: "" };

describe("isUuid", () => {
  it("acepta UUIDs v4 en minúsculas y mayúsculas", () => {
    expect(isUuid(ORG)).toBe(true);
    expect(isUuid("AAAAAAAA-0000-4000-8000-00000000001A")).toBe(true);
  });
  it("rechaza cadenas que no son UUID", () => {
    for (const bad of ["", "ASSET-101", "../etc", "00000000-0000-0000-0000-00000000000", null, undefined, 42]) {
      expect(isUuid(bad)).toBe(false);
    }
  });
});

describe("validateHandoverInput", () => {
  it("acepta un relevo con al menos un bloque y recorta espacios", () => {
    const r = validateHandoverInput({
      department: "recepcion",
      shiftType: "manana",
      items: { ...EMPTY_BLOCKS, pendientes: "  Revisar minibar 101  " },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.department).toBe("recepcion");
      expect(r.value.items).toEqual([{ block: "pendientes", content: "Revisar minibar 101" }]);
    }
  });

  it("rechaza un relevo sin ningún bloque con contenido (solo espacios)", () => {
    const r = validateHandoverInput({
      department: "recepcion",
      shiftType: "manana",
      items: { ...EMPTY_BLOCKS, avisos: "   \n " },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/al menos un bloque/i);
  });

  it("rechaza departamento o turno fuera del catálogo", () => {
    expect(validateHandoverInput({ department: "spa", shiftType: "manana", items: { ...EMPTY_BLOCKS, vips: "x" } }).ok).toBe(false);
    expect(validateHandoverInput({ department: "pisos", shiftType: "madrugada", items: { ...EMPTY_BLOCKS, vips: "x" } }).ok).toBe(false);
  });

  it("ignora claves de bloque desconocidas en vez de enviarlas a la base de datos", () => {
    const r = validateHandoverInput({
      department: "pisos",
      shiftType: "tarde",
      items: { ...EMPTY_BLOCKS, vips: "Sr. Ejemplo", "__proto__": "x", secreto: "y" } as Record<string, string>,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items.map((i) => i.block)).toEqual(["vips"]);
  });

  it("rechaza bloques que superan el límite de caracteres", () => {
    const r = validateHandoverInput({
      department: "pisos",
      shiftType: "tarde",
      items: { ...EMPTY_BLOCKS, incidencias: "a".repeat(LIMITS.handoverContent + 1) },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Incidencias/);
  });

  it("acepta exactamente el límite", () => {
    const r = validateHandoverInput({
      department: "pisos",
      shiftType: "tarde",
      items: { ...EMPTY_BLOCKS, incidencias: "a".repeat(LIMITS.handoverContent) },
    });
    expect(r.ok).toBe(true);
  });
});

describe("validateTicketInput", () => {
  const base = { title: "Grifo gotea", description: "", priority: "normal", assetId: undefined };

  it("acepta un parte mínimo y normaliza descripción vacía a null", () => {
    const r = validateTicketInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ title: "Grifo gotea", description: null, priority: "normal", assetId: null });
  });

  it("rechaza título vacío o solo espacios", () => {
    expect(validateTicketInput({ ...base, title: "   " }).ok).toBe(false);
  });

  it("rechaza título por encima del límite", () => {
    expect(validateTicketInput({ ...base, title: "x".repeat(LIMITS.ticketTitle + 1) }).ok).toBe(false);
    expect(validateTicketInput({ ...base, title: "x".repeat(LIMITS.ticketTitle) }).ok).toBe(true);
  });

  it("rechaza descripción por encima del límite", () => {
    expect(validateTicketInput({ ...base, description: "x".repeat(LIMITS.ticketDescription + 1) }).ok).toBe(false);
  });

  it("rechaza prioridad fuera del catálogo", () => {
    expect(validateTicketInput({ ...base, priority: "urgentisima" }).ok).toBe(false);
  });

  it("el activo debe ser un UUID (id de ticket_assets), no el texto del QR", () => {
    expect(validateTicketInput({ ...base, assetId: "ASSET-101" }).ok).toBe(false);
    const r = validateTicketInput({ ...base, assetId: ORG });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.assetId).toBe(ORG);
  });
});

describe("validatePhoto", () => {
  const photo = (over: Partial<{ size: number; type: string; name: string }> = {}) => ({
    size: 1024, type: "image/jpeg", name: "foto.jpg", ...over,
  });

  it("acepta jpeg/png/webp dentro del límite y deriva la extensión del MIME, no del nombre", () => {
    for (const [type, ext] of Object.entries(ALLOWED_PHOTO_TYPES)) {
      const r = validatePhoto(photo({ type, name: "x.exe/../../etc" }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.ext).toBe(ext);
    }
  });

  it("rechaza fotos mayores de 10 MB (mismo límite que el bucket)", () => {
    expect(LIMITS.photoBytes).toBe(10 * 1024 * 1024);
    expect(validatePhoto(photo({ size: LIMITS.photoBytes })).ok).toBe(true);
    const r = validatePhoto(photo({ size: LIMITS.photoBytes + 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/10 MB/);
  });

  it("rechaza ficheros vacíos", () => {
    expect(validatePhoto(photo({ size: 0 })).ok).toBe(false);
  });

  it("rechaza tipos no permitidos (gif, svg, pdf, vacío)", () => {
    for (const type of ["image/gif", "image/svg+xml", "application/pdf", ""]) {
      expect(validatePhoto(photo({ type })).ok).toBe(false);
    }
  });
});

describe("buildPhotoPath", () => {
  it("construye org/uuid.ext", () => {
    expect(buildPhotoPath(ORG, "jpg", "11111111-1111-4111-8111-111111111111")).toBe(
      `${ORG}/11111111-1111-4111-8111-111111111111.jpg`,
    );
  });

  it("rechaza org o nombre de fichero que no sean UUID (sin traversal posible)", () => {
    expect(() => buildPhotoPath("../otra-org", "jpg", "11111111-1111-4111-8111-111111111111")).toThrow();
    expect(() => buildPhotoPath(ORG, "jpg", "../../x")).toThrow();
    expect(() => buildPhotoPath(ORG, "jpg/../x", "11111111-1111-4111-8111-111111111111")).toThrow();
  });
});

describe("photoBytesMatchType — la foto es lo que dice ser (F3, informe e2e 27/10)", () => {
  const bytes = (...b: number[]) => Uint8Array.from(b);
  const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1);
  const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d);
  const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);
  const TEXT = new TextEncoder().encode("esto no es un jpeg");

  it("acepta cabeceras reales de JPEG, PNG y WebP con su tipo", () => {
    expect(photoBytesMatchType("image/jpeg", JPEG)).toBe(true);
    expect(photoBytesMatchType("image/png", PNG)).toBe(true);
    expect(photoBytesMatchType("image/webp", WEBP)).toBe(true);
  });

  it("rechaza texto con tipo de imagen y cabeceras cruzadas", () => {
    expect(photoBytesMatchType("image/jpeg", TEXT)).toBe(false);
    expect(photoBytesMatchType("image/png", JPEG)).toBe(false);
    expect(photoBytesMatchType("image/webp", bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20))).toBe(false);
  });

  it("rechaza tipos fuera de la lista y cabeceras demasiado cortas", () => {
    expect(photoBytesMatchType("image/gif", JPEG)).toBe(false);
    expect(photoBytesMatchType("image/jpeg", bytes(0xff, 0xd8))).toBe(false);
  });
});
