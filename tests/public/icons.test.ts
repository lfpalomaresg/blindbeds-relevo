/**
 * Iconos de la PWA (R5): existen, son PNG de verdad, tienen el tamaño que
 * declara el manifest y usan el amarillo de marca (#F0AB00) de fondo.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const manifest = JSON.parse(readFileSync(path.join(ROOT, "public/manifest.json"), "utf8")) as {
  theme_color: string;
  description: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decodifica un PNG RGB/RGBA 8 bits sin entrelazar (lo que genera el script). */
function decodePng(buf: Buffer) {
  expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  let off = 8;
  let width = 0, height = 0, colorType = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      colorType = data[9];
      expect(data[12]).toBe(0);
    }
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = (v + p) & 0xff;
    }
  }
  const at = (x: number, y: number) => [...px.subarray(y * stride + x * bpp, y * stride + x * bpp + 3)];
  return { width, height, at };
}

describe("iconos de la PWA", () => {
  it("el manifest declara 192 y 512 en PNG y el color de tema es el amarillo de marca", () => {
    expect(manifest.icons.map((i) => i.sizes).sort()).toEqual(["192x192", "512x512"]);
    expect(manifest.theme_color.toUpperCase()).toBe("#F0AB00");
    expect(manifest.description).not.toMatch(/suite/i);
  });

  it.each([
    ["/icon-192.png", 192],
    ["/icon-512.png", 512],
  ])("%s existe, es PNG de %ipx, fondo #F0AB00 y letra en gris #97999B", (src, size) => {
    const icon = decodePng(readFileSync(path.join(ROOT, "public", src)));
    expect([icon.width, icon.height]).toEqual([size, size]);
    expect(icon.at(2, 2)).toEqual([0xf0, 0xab, 0x00]);
    // Algún píxel del centro es exactamente el gris de marca (trazo de la letra).
    let grey = 0;
    for (let y = Math.floor(size * 0.25); y < size * 0.75; y += 2)
      for (let x = Math.floor(size * 0.25); x < size * 0.75; x += 2) {
        const [r, g, b] = icon.at(x, y);
        if (r === 0x97 && g === 0x99 && b === 0x9b) grey++;
      }
    expect(grey).toBeGreaterThan(20);
  });
});
