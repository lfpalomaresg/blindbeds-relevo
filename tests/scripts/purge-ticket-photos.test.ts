import { describe, expect, it } from "vitest";
import { selectExpiredPhotos } from "../../scripts/purge-ticket-photos.mjs";

const NOW = new Date("2026-11-01T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const row = (over: Partial<{ id: string; photo_path: string | null; status: string; closed_at: string | null }>) => ({
  id: "t",
  photo_path: "org/foto.png",
  status: "cerrado",
  closed_at: daysAgo(100),
  ...over,
});

describe("selectExpiredPhotos", () => {
  it("selecciona fotos de partes cerrados hace más de 90 días", () => {
    const out = selectExpiredPhotos([row({ id: "a" })], NOW, 90);
    expect(out.map((r) => r.id)).toEqual(["a"]);
  });

  it("deja los cerrados dentro del plazo", () => {
    expect(selectExpiredPhotos([row({ closed_at: daysAgo(89) })], NOW, 90)).toHaveLength(0);
    expect(selectExpiredPhotos([row({ closed_at: daysAgo(90) })], NOW, 90)).toHaveLength(0);
  });

  it("no toca partes abiertos ni en curso aunque tengan foto antigua", () => {
    expect(selectExpiredPhotos([row({ status: "abierto" })], NOW, 90)).toHaveLength(0);
    expect(selectExpiredPhotos([row({ status: "en_curso" })], NOW, 90)).toHaveLength(0);
  });

  it("ignora partes sin foto y sin closed_at o con fecha inválida", () => {
    expect(selectExpiredPhotos([row({ photo_path: null })], NOW, 90)).toHaveLength(0);
    expect(selectExpiredPhotos([row({ closed_at: null })], NOW, 90)).toHaveLength(0);
    expect(selectExpiredPhotos([row({ closed_at: "no-es-fecha" })], NOW, 90)).toHaveLength(0);
  });

  it("respeta el número de días recibido", () => {
    expect(selectExpiredPhotos([row({ closed_at: daysAgo(31) })], NOW, 30)).toHaveLength(1);
    expect(selectExpiredPhotos([row({ closed_at: daysAgo(31) })], NOW, 60)).toHaveLength(0);
  });
});
