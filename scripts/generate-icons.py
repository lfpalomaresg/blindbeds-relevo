#!/usr/bin/env python3
"""Genera los iconos de la PWA (public/icon-192.png y public/icon-512.png).

Sin dependencias (solo la biblioteca estándar): fondo amarillo de marca
#F0AB00 a sangre (vale como icono «maskable») y una «R» geométrica en gris de
marca #97999B dentro de la zona segura central. Bordes suavizados por
supermuestreo 4x4.

Uso:  python3 scripts/generate-icons.py
"""
import math
import struct
import zlib
from pathlib import Path

YELLOW = (0xF0, 0xAB, 0x00)
GREY = (0x97, 0x99, 0x9B)
SS = 4  # supermuestreo por eje


def in_r(x: float, y: float) -> bool:
    """¿El punto (x, y), en coordenadas de la letra (alto 1, ancho ~0.82), cae en la «R»?"""
    if not (0 <= y <= 1 and 0 <= x <= 0.82):
        return False
    stroke = 0.2
    # Asta vertical.
    if x <= stroke:
        return True
    # Panza: barras superior y central hasta x=0.5 y semianillo a la derecha.
    cx, cy, r_out = 0.5, 0.29, 0.29
    r_in = r_out - stroke
    if x <= cx and (y <= stroke or (2 * cy - stroke <= y <= 2 * cy)):
        return True
    if x > cx:
        d = math.hypot(x - cx, y - cy)
        if r_in <= d <= r_out:
            return True
    # Pierna: banda diagonal desde la panza hasta la esquina inferior derecha.
    ax, ay, bx, by = 0.38, 2 * cy - stroke / 2, 0.72, 1.0
    vx, vy = bx - ax, by - ay
    t = ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)
    if 0 <= t <= 1:
        px, py = ax + t * vx, ay + t * vy
        if math.hypot(x - px, y - py) <= stroke / 2 * 1.1:
            return True
    return False


def render(size: int) -> bytes:
    letter_h = size * 0.5  # dentro de la zona segura (círculo del 80 %)
    letter_w = letter_h * 0.82
    ox = (size - letter_w) / 2
    oy = (size - letter_h) / 2
    rows = []
    for py in range(size):
        row = bytearray([0])  # filtro None
        for px in range(size):
            hits = 0
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS - ox) / letter_h
                    y = (py + (sy + 0.5) / SS - oy) / letter_h
                    hits += in_r(x, y)
            a = hits / (SS * SS)
            row += bytes(round(GREY[i] * a + YELLOW[i] * (1 - a)) for i in range(3))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8 bits, RGB
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main() -> None:
    public = Path(__file__).resolve().parent.parent / "public"
    for size in (192, 512):
        out = public / f"icon-{size}.png"
        out.write_bytes(render(size))
        print(f"{out.relative_to(public.parent)}  {size}x{size}")


if __name__ == "__main__":
    main()
