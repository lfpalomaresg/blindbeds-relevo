// Decode QR from canvas ImageData using jsQR (client-side only)
export function decodeQR(
  data: Uint8ClampedArray,
  width: number,
  height: number
): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jsQR = require("jsqr") as typeof import("jsqr").default;
    const result = jsQR(data, width, height);
    return result?.data ?? null;
  } catch {
    return null;
  }
}
