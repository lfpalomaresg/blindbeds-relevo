// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceWorker } from "@/components/ServiceWorker";

function mockServiceWorker(registrations: { unregister: () => Promise<boolean> }[] = []) {
  const container = {
    register: vi.fn(() => Promise.resolve({})),
    getRegistrations: vi.fn(() => Promise.resolve(registrations)),
  };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
  return container;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("ServiceWorker", () => {
  it("en producción registra /sw.js", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const sw = mockServiceWorker();
    render(<ServiceWorker />);

    await waitFor(() => expect(sw.register).toHaveBeenCalledWith("/sw.js"));
  });

  it("en desarrollo no registra el service worker y quita el que quedara de antes", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const stale = { unregister: vi.fn(() => Promise.resolve(true)) };
    const sw = mockServiceWorker([stale]);
    render(<ServiceWorker />);

    await waitFor(() => expect(stale.unregister).toHaveBeenCalledTimes(1));
    expect(sw.register).not.toHaveBeenCalled();
  });

  it("en test tampoco lo registra", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const sw = mockServiceWorker();
    render(<ServiceWorker />);

    await waitFor(() => expect(sw.getRegistrations).toHaveBeenCalled());
    expect(sw.register).not.toHaveBeenCalled();
  });
});
