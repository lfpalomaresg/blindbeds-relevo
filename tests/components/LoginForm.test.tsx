// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R1: el enlace mágico debe volver a /auth/callback, que canjea el `code` por
 * una sesión en cookies y redirige a /dashboard (por defecto). Si vuelve a la
 * raíz, el proxy lo manda a /login y nadie canjea el `code`.
 */
const state = vi.hoisted(() => ({
  signInWithOtp: null as unknown as ReturnType<typeof import("vitest").vi.fn>,
}));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { signInWithOtp: state.signInWithOtp } }),
}));

import { LoginForm } from "@/components/auth/LoginForm";

beforeEach(() => {
  state.signInWithOtp = vi.fn(async () => ({ error: null }));
});
afterEach(cleanup);

function submitEmail(email: string) {
  render(<LoginForm />);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.submit(screen.getByRole("button", { name: /acceder/i }).closest("form")!);
}

describe("LoginForm — enlace mágico", () => {
  it("pide el enlace con redirect a /auth/callback del mismo origen (no a la raíz)", async () => {
    submitEmail("persona@example.test");
    await screen.findByText(/revisa tu email/i);
    expect(state.signInWithOtp).toHaveBeenCalledTimes(1);
    const [{ email, options }] = state.signInWithOtp.mock.calls[0] as [{ email: string; options: { emailRedirectTo: string } }];
    expect(email).toBe("persona@example.test");
    const redirect = new URL(options.emailRedirectTo);
    expect(redirect.origin).toBe(window.location.origin);
    expect(redirect.pathname).toBe("/auth/callback");
  });

  it("si Supabase devuelve error no da el enlace por enviado y lo explica en español", async () => {
    state.signInWithOtp = vi.fn(async () => ({
      error: { code: "over_email_send_rate_limit", status: 429, message: "For security purposes, you can only request this after 37 seconds." },
    }));
    submitEmail("persona@example.test");
    expect((await screen.findByRole("alert")).textContent).toContain("Espera 37 segundos");
    expect(screen.queryByText(/for security purposes/i)).toBeNull();
    expect(screen.queryByText(/revisa tu email/i)).toBeNull();
  });

  it("no crea cuentas: pide el enlace solo para usuarios ya dados de alta", async () => {
    submitEmail("persona@example.test");
    await screen.findByText(/revisa tu email/i);
    const [{ options }] = state.signInWithOtp.mock.calls[0] as [{ options: { shouldCreateUser?: boolean } }];
    expect(options.shouldCreateUser).toBe(false);
  });

  it("un correo no dado de alta ve lo mismo que uno dado de alta (no delata quién existe)", async () => {
    state.signInWithOtp = vi.fn(async () => ({ error: { code: "otp_disabled", status: 422, message: "Signups not allowed for otp" } }));
    submitEmail("nadie@example.test");
    await screen.findByText(/revisa tu email/i);
    expect(screen.getByText(/si .*está dado de alta/i)).toBeTruthy();
    expect(screen.queryByText(/signups not allowed/i)).toBeNull();
  });
});
