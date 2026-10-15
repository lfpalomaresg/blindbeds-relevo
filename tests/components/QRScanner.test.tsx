// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QRScanner } from "@/components/tickets/QRScanner";

function mockCameraError(name: string) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(() => Promise.reject(new DOMException("camera error", name))) },
  });
}

afterEach(cleanup);

describe("QRScanner sin cámara", () => {
  it("sin cámara (NotFoundError) no habla de permisos y ofrece seguir sin escanear, que cierra el escáner", async () => {
    mockCameraError("NotFoundError");
    const onClose = vi.fn();
    render(<QRScanner onScan={vi.fn()} onClose={onClose} />);

    await screen.findByText(/no se pudo acceder a la cámara\./i);
    expect(screen.queryByText(/permiso|permite el acceso|denegado/i)).toBeNull();
    expect(screen.queryByText(/manualmente/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /continuar sin escanear/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("con el permiso denegado (NotAllowedError) indica cómo permitir el acceso", async () => {
    mockCameraError("NotAllowedError");
    render(<QRScanner onScan={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText(/permite el acceso desde la configuración del navegador/i);
  });
});
