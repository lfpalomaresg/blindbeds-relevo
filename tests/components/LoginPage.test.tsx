// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * R4: /auth/callback y /auth/confirm devuelven /login?error=auth|config. La
 * página debe explicarlo en español y nunca reflejar el valor recibido.
 */
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { signInWithOtp: vi.fn() } }),
}));

import LoginPage from "@/app/login/page";

async function renderWith(params: Record<string, string | string[] | undefined>) {
  const ui = await LoginPage({ searchParams: Promise.resolve(params) });
  return render(ui);
}

afterEach(cleanup);

describe("/login — errores devueltos por los callbacks de auth", () => {
  it("sin error no muestra ningún aviso", async () => {
    await renderWith({});
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("error=auth explica que el enlace no vale o ha caducado", async () => {
    await renderWith({ error: "auth" });
    expect(screen.getByRole("alert").textContent).toMatch(/enlace.*(no es válido|caducado)/i);
  });

  it("error=config explica que falta configuración", async () => {
    await renderWith({ error: "config" });
    expect(screen.getByRole("alert").textContent).toMatch(/configura/i);
  });

  it("un error desconocido muestra un mensaje genérico y no refleja el valor (ni HTML)", async () => {
    const payload = '<img src=x onerror="alert(1)">';
    const { container } = await renderWith({ error: payload });
    expect(screen.getByRole("alert").textContent).toMatch(/no se ha podido iniciar sesión/i);
    expect(container.innerHTML).not.toContain("onerror");
    expect(container.textContent).not.toContain(payload);
    expect(container.querySelector("img")).toBeNull();
  });

  it("si llega repetido (?error=a&error=b) se trata igual, sin reflejarlo", async () => {
    await renderWith({ error: ["auth", "x"] });
    expect(screen.getByRole("alert").textContent).toMatch(/enlace/i);
  });
});
