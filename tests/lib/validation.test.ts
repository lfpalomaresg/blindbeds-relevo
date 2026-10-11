import { describe, expect, it } from "vitest";
import {
  ALLOWED_PHOTO_TYPES,
  LIMITS,
  buildPhotoPath,
  isUuid,
  validateHandoverInput,
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
