// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../harness/fake-supabase";

const state = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => state.fake,
}));

import { PendingItems } from "@/components/handover/PendingItems";

const ORG = "00000000-0000-0000-0000-00000000000a";
const ITEMS = [
  { id: "i1", org_id: ORG, resolved: false, block: "pendientes", content: "Revisar minibar 101", created_at: "2026-01-01T10:00:00Z" },
  { id: "i2", org_id: ORG, resolved: false, block: "incidencias", content: "Fuga en 204", created_at: "2026-01-01T11:00:00Z" },
];

function setup(options: ConstructorParameters<typeof FakeSupabase>[0] = {}) {
  state.fake = new FakeSupabase({ tables: { handover_items: ITEMS }, ...options });
  render(<PendingItems orgId={ORG} />);
  return state.fake;
}

afterEach(cleanup);

describe("PendingItems", () => {
  it("muestra estado de carga y luego los pendientes con su bloque", async () => {
    setup();
    expect(screen.getByText(/cargando/i)).toBeTruthy();
    await screen.findByText(/Revisar minibar 101/);
    expect(screen.getByText(/Fuga en 204/)).toBeTruthy();
    expect(screen.getByText(/^Pendientes$/)).toBeTruthy();
    expect(screen.getByText(/^Incidencias$/)).toBeTruthy();
  });

  it("muestra el estado vacío cuando no hay pendientes", async () => {
    setup({ tables: { handover_items: [] } });
    await screen.findByText(/no hay pendientes/i);
  });

  it("consulta solo los no resueltos de la organización", async () => {
    const fake = setup();
    await screen.findByText(/Revisar minibar 101/);
    const [query] = fake.callsTo("handover_items", "select");
    expect(query.filters).toEqual(expect.arrayContaining([["org_id", ORG], ["resolved", false]]));
  });

  // Desde 000014 se resuelve con resolve_handover_item(): quién y cuándo los
  // fija la base de datos; la app ya no hace UPDATE directo.
  const resolves = (fake: FakeSupabase) => fake.rpcCalls.filter((c) => c.fn === "resolve_handover_item");

  it("«Resolver» llama a resolve_handover_item y lo quita de la lista", async () => {
    const fake = setup({ user: { id: "user-sup" } });
    await screen.findByText(/Revisar minibar 101/);
    fireEvent.click(screen.getAllByRole("button", { name: /resolver/i })[0]);
    await waitFor(() => expect(screen.queryByText(/Revisar minibar 101/)).toBeNull());
    expect(resolves(fake)).toEqual([{ fn: "resolve_handover_item", args: { p_item_id: "i1" } }]);
    expect(fake.callsTo("handover_items", "update")).toHaveLength(0);
    expect(screen.getByText(/Fuga en 204/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("si la base de datos rechaza la resolución, el pendiente sigue visible y se avisa", async () => {
    setup({ user: { id: "user-sup" }, rpcResults: { resolve_handover_item: { data: null, error: { message: "permission denied" } } } });
    await screen.findByText(/Revisar minibar 101/);
    fireEvent.click(screen.getAllByRole("button", { name: /resolver/i })[0]);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/no se pudo resolver/i);
    expect(screen.getByText(/Revisar minibar 101/)).toBeTruthy();
  });

  // La RPC devuelve false en dos casos distintos: otra persona se adelantó, o
  // quien pulsa ya no tiene acceso (hotel suspendido, membresía retirada; RLS
  // oculta entonces el ítem). La app vuelve a leer el ítem para distinguirlos.
  const rpcFalse = { resolve_handover_item: { data: false, error: null } };

  it("si ya estaba resuelto por otra persona (false y el ítem se lee resuelto), lo quita de la lista y lo indica", async () => {
    const fake = setup({ user: { id: "user-sup" }, rpcResults: rpcFalse });
    await screen.findByText(/Revisar minibar 101/);
    fake.options.tables = { handover_items: ITEMS.map((i) => (i.id === "i1" ? { ...i, resolved: true } : i)) };
    fireEvent.click(screen.getAllByRole("button", { name: /resolver/i })[0]);
    await screen.findByRole("status");
    expect(screen.getByRole("status").textContent).toMatch(/ya estaba resuelto/i);
    expect(screen.queryByText(/Revisar minibar 101/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    const recheck = fake.callsTo("handover_items", "select").at(-1);
    expect(recheck?.filters).toEqual(expect.arrayContaining([["id", "i1"]]));
  });

  it("si el ítem ya no es visible (hotel suspendido o sin membresía), avisa del fallo y no lo da por resuelto", async () => {
    const fake = setup({ user: { id: "user-sup" }, rpcResults: rpcFalse });
    await screen.findByText(/Revisar minibar 101/);
    fake.options.tables = { handover_items: [] };
    fireEvent.click(screen.getAllByRole("button", { name: /resolver/i })[0]);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/no se pudo resolver/i);
    expect(screen.getByRole("alert").textContent).toMatch(/acceso/i);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/Revisar minibar 101/)).toBeTruthy();
  });

  it("si la RPC devuelve false y el ítem sigue sin resolver, avisa del fallo y lo deja en la lista", async () => {
    setup({ user: { id: "user-sup" }, rpcResults: rpcFalse });
    await screen.findByText(/Revisar minibar 101/);
    fireEvent.click(screen.getAllByRole("button", { name: /resolver/i })[0]);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/no se pudo resolver/i);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/Revisar minibar 101/)).toBeTruthy();
  });

  it("sin sesión no intenta resolver nada y avisa de volver a iniciar sesión", async () => {
    const fake = setup({ user: null });
    await screen.findByText(/Revisar minibar 101/);
    fireEvent.click(screen.getAllByRole("button", { name: /resolver/i })[0]);
    await waitFor(() => expect(fake.auth.getUser).toHaveBeenCalled());
    expect((await screen.findByRole("alert")).textContent).toMatch(/vuelve a iniciar sesión/i);
    expect(resolves(fake)).toHaveLength(0);
    expect(screen.getByText(/Revisar minibar 101/)).toBeTruthy();
  });

  // Nunca se muestra el texto del servidor (puede nombrar tablas, funciones o
  // políticas internas); mismo criterio que HandoverForm y TicketForm.
  // 42501 (insufficient_privilege) llega tanto sin sesión como con una sesión
  // válida sin permiso (p. ej. el token caducó y la llamada entra como anon, o se
  // retiró el EXECUTE): el mensaje nombra las dos causas y no manda solo a
  // «iniciar sesión».
  it.each([
    ["sin sesión en el servidor", "authentication required"],
    ["con usuario válido pero sin permiso", "permission denied for function resolve_handover_item"],
  ])("un 42501 (%s) da un mensaje propio de acceso o sesión, sin el texto del servidor", async (_caso, serverMessage) => {
    setup({
      user: { id: "user-sup" },
      rpcResults: { resolve_handover_item: { data: null, error: { code: "42501", message: serverMessage } } },
    });
    await screen.findByText(/Revisar minibar 101/);
    fireEvent.click(screen.getAllByRole("button", { name: /resolver/i })[0]);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/no tienes acceso a este pendiente/i);
    expect(alert.textContent).toMatch(/sesión caducó/i);
    expect(alert.textContent).toMatch(/avisa al responsable/i);
    expect(alert.textContent).not.toMatch(/authentication|required|permission|denied|resolve_handover_item/);
    expect(screen.getByText(/Revisar minibar 101/)).toBeTruthy();
  });

  it("cualquier otro error da un mensaje genérico, sin el texto del servidor", async () => {
    setup({
      user: { id: "user-sup" },
      rpcResults: { resolve_handover_item: { data: null, error: { code: "42883", message: "function public.resolve_handover_item(uuid) does not exist" } } },
    });
    await screen.findByText(/Revisar minibar 101/);
    fireEvent.click(screen.getAllByRole("button", { name: /resolver/i })[0]);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/no se pudo resolver/i);
    expect(alert.textContent).not.toMatch(/function|resolve_handover_item|exist/);
  });

  // Un doble toque mandaba dos RPC: la segunda devuelve false, se relee el ítem
  // ya resuelto y salía «ya estaba resuelto por otra persona», que es falso.
  it("un doble toque en «Resolver» envía una sola RPC y no da el aviso de «otra persona»", async () => {
    const fake = setup({ user: { id: "user-sup" } });
    await screen.findByText(/Revisar minibar 101/);
    const button = screen.getAllByRole("button", { name: /resolver/i })[0];
    // Los dos clics en el mismo act: sin re-render entre ellos el botón aún no
    // está desactivado, así que la que frena el segundo es la guarda del componente.
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() => expect(screen.queryByText(/Revisar minibar 101/)).toBeNull());
    expect(resolves(fake)).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("mientras se resuelve, el botón de ese pendiente está desactivado", async () => {
    setup({ user: { id: "user-sup" } });
    await screen.findByText(/Revisar minibar 101/);
    const [first, second] = screen.getAllByRole("button", { name: /resolver/i });
    fireEvent.click(first);
    expect(first.hasAttribute("disabled")).toBe(true);
    expect(second.hasAttribute("disabled")).toBe(false);
    await waitFor(() => expect(screen.queryByText(/Revisar minibar 101/)).toBeNull());
  });
});
