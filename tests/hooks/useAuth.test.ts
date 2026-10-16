// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * useAuth decide, en cliente, si se muestra el panel y con qué organización.
 * La protección real está en el proxy y en RLS; aquí se comprueba que sin
 * sesión se manda a /login y que, con sesión, la carga termina siempre.
 */
const state = vi.hoisted(() => ({
  session: null as unknown,
  authCallback: null as null | ((event: string, session: unknown) => void),
  unsubscribe: null as unknown as ReturnType<typeof vi.fn>,
  push: null as unknown as ReturnType<typeof vi.fn>,
  getOrganization: null as unknown as Mock<() => Promise<unknown>>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        state.authCallback = cb;
        return { data: { subscription: { unsubscribe: state.unsubscribe } } };
      },
    },
  }),
}));

vi.mock("@/lib/org", () => ({
  getOrganization: () => state.getOrganization(),
}));

import { useAuth } from "@/hooks/useAuth";

const ORG = { id: "00000000-0000-0000-0000-00000000000a", name: "Hotel A", status: "active", created_at: "x" };

function setup({ session = { user: { id: "u1" } } as unknown, org = ORG as unknown } = {}) {
  state.session = session;
  state.authCallback = null;
  state.unsubscribe = vi.fn();
  state.push = vi.fn();
  state.getOrganization = vi.fn(async () => org);
  return renderHook(() => useAuth());
}

afterEach(cleanup);

describe("useAuth", () => {
  it("con sesión carga la organización y termina la carga", async () => {
    const { result } = setup();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.org).toEqual(ORG);
    expect(state.push).not.toHaveBeenCalled();
  });

  it("sin sesión redirige a /login y no consulta la organización", async () => {
    setup({ session: null });
    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/login"));
    expect(state.getOrganization).not.toHaveBeenCalled();
  });

  it("si la sesión se cierra después, redirige a /login", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    state.authCallback!("SIGNED_OUT", null);
    expect(state.push).toHaveBeenCalledWith("/login");
  });

  it("un refresco de token con sesión válida no redirige", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    state.authCallback!("TOKEN_REFRESHED", { user: { id: "u1" } });
    expect(state.push).not.toHaveBeenCalled();
  });

  it("sin organización activa termina la carga con org null (el panel muestra el aviso)", async () => {
    const { result } = setup({ org: null });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.org).toBeNull();
  });

  it("al desmontar cancela la suscripción a cambios de sesión", async () => {
    const { result, unmount } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();
    expect(state.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
