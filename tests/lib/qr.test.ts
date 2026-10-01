import { describe, it, expect } from "vitest";
import { decodeQR } from "@/lib/qr";

describe("decodeQR", () => {
  it("returns null for blank image (all zeros)", () => {
    const empty = new Uint8ClampedArray(4 * 10 * 10);
    expect(decodeQR(empty, 10, 10)).toBeNull();
  });

  it("returns null for non-QR image data", () => {
    const noise = new Uint8ClampedArray(4 * 10 * 10).fill(128);
    expect(decodeQR(noise, 10, 10)).toBeNull();
  });

  it("does not throw for empty data", () => {
    const data = new Uint8ClampedArray(0);
    expect(() => decodeQR(data, 0, 0)).not.toThrow();
  });
});
