// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../harness/fake-supabase";

const state = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => state.fake,
}));

import { TicketList } from "@/components/tickets/TicketList";
import { PHOTO_URL_TTL_SECONDS } from "@/lib/photos";

const ORG = "00000000-0000-0000-0000-00000000000a";
const TICKETS = [
  { id: "t1", org_id: ORG, title: "Grifo gotea", description: "Baño 101", priority: "normal", status: "abierto", created_at: "2026-01-01T10:00:00Z" },
  { id: "t2", org_id: ORG, title: "Luz fundida", priority: "baja", status: "en_curso", created_at: "2026-01-01T11:00:00Z" },
  { id: "t3", org_id: ORG, title: "Ascensor", priority: "critica", status: "cerrado", created_at: "2026-01-01T12:00:00Z" },
];

function setup(options: ConstructorParameters<typeof FakeSupabase>[0] = {}) {
  state.fake = new FakeSupabase({ tables: { maintenance_tickets: TICKETS }, ...options });
  render(<TicketList orgId={ORG} />);
  return state.fake;
}

afterEach(cleanup);

describe("TicketList", () => {
  it("por defecto muestra los partes abiertos Y en curso de la organización (no los cerrados)", async () => {
    const fake = setup();
    await screen.findByText("Grifo gotea");
    expect(screen.getByText("Luz fundida")).toBeTruthy();
    expect(screen.queryByText("Ascensor")).toBeNull();
    const [query] = fake.callsTo("maintenance_tickets", "select");
    expect(query.filters).toEqual(expect.arrayContaining([["org_id", ORG], ["status", { in: ["abierto", "en_curso"] }]]));
  });

  it("el filtro «Abierto» sigue mostrando solo los abiertos", async () => {
    setup();
    await screen.findByText("Luz fundida");
    fireEvent.click(within(screen.getByRole("group", { name: /filtrar por estado/i })).getByRole("button", { name: /^abierto$/i }));
    await waitFor(() => expect(screen.queryByText("Luz fundida")).toBeNull());
    expect(screen.getByText("Grifo gotea")).toBeTruthy();
  });

  it("el filtro «Todas» quita el filtro de estado y muestra todos", async () => {
    setup();
    await screen.findByText("Grifo gotea");
    fireEvent.click(screen.getByRole("button", { name: /^todas$/i }));
    await screen.findByText("Ascensor");
    expect(screen.getByText("Luz fundida")).toBeTruthy();
  });

  it("muestra el estado vacío con el nombre del filtro", async () => {
    setup({ tables: { maintenance_tickets: [] } });
    await screen.findByText(/no hay partes abiertos ni en curso/i);
  });

  // El cambio de estado y su traza en ticket_updates los hace la función
  // change_ticket_status en una sola transacción (ver tests/db/rls.test.ts).
  it("«En curso» cambia el estado con change_ticket_status desde el estado que se veía", async () => {
    const fake = setup({ user: { id: "user-mant" } });
    const card = within(await screen.findByRole("article", { name: "Grifo gotea" }));
    fireEvent.click(card.getByRole("button", { name: /^en curso$/i }));
    await waitFor(() => expect(fake.rpcCalls).toHaveLength(1));
    expect(fake.rpcCalls[0]).toEqual({
      fn: "change_ticket_status",
      args: { p_ticket_id: "t1", p_from: "abierto", p_to: "en_curso" },
    });
  });

  it("no hace escrituras sueltas (update + insert no atómicos) desde el cliente", async () => {
    const fake = setup({ user: { id: "user-mant" } });
    const card = within(await screen.findByRole("article", { name: "Grifo gotea" }));
    fireEvent.click(card.getByRole("button", { name: /^cerrar$/i }));
    await waitFor(() => expect(fake.rpcCalls).toHaveLength(1));
    expect(fake.callsTo("maintenance_tickets", "update")).toHaveLength(0);
    expect(fake.callsTo("ticket_updates", "insert")).toHaveLength(0);
  });

  it("«Cerrar» pide el cierre desde el estado actual del parte", async () => {
    const fake = setup({ user: { id: "user-mant" } });
    await screen.findByText("Grifo gotea");
    fireEvent.click(screen.getByRole("button", { name: /^todas$/i }));
    const card = within(await screen.findByRole("article", { name: "Luz fundida" }));
    fireEvent.click(card.getByRole("button", { name: /^cerrar$/i }));
    await waitFor(() => expect(fake.rpcCalls).toHaveLength(1));
    expect(fake.rpcCalls[0].args).toEqual({ p_ticket_id: "t2", p_from: "en_curso", p_to: "cerrado" });
  });

  it("sin sesión no cambia estados", async () => {
    const fake = setup({ user: null });
    const card = within(await screen.findByRole("article", { name: "Grifo gotea" }));
    fireEvent.click(card.getByRole("button", { name: /^cerrar$/i }));
    await waitFor(() => expect(fake.auth.getUser).toHaveBeenCalled());
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("si otro usuario ya cambió el parte (la función devuelve false), avisa y recarga", async () => {
    const fake = setup({ user: { id: "user-mant" }, rpcResults: { change_ticket_status: { data: false, error: null } } });
    const card = within(await screen.findByRole("article", { name: "Grifo gotea" }));
    fireEvent.click(card.getByRole("button", { name: /^en curso$/i }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/cambió de estado/i);
    expect(fake.callsTo("maintenance_tickets", "select")).toHaveLength(2);
  });

  it("si la base de datos rechaza el cambio, muestra el error", async () => {
    setup({ user: { id: "user-mant" }, rpcResults: { change_ticket_status: { data: null, error: { message: "permission denied" } } } });
    const card = within(await screen.findByRole("article", { name: "Grifo gotea" }));
    fireEvent.click(card.getByRole("button", { name: /^cerrar$/i }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/no se pudo actualizar/i);
  });

  it("si el cambio se aplica, no muestra ningún aviso", async () => {
    const fake = setup({ user: { id: "user-mant" } });
    const card = within(await screen.findByRole("article", { name: "Grifo gotea" }));
    fireEvent.click(card.getByRole("button", { name: /^en curso$/i }));
    await waitFor(() => expect(fake.callsTo("maintenance_tickets", "select")).toHaveLength(2));
    await screen.findByRole("group", { name: /filtrar por estado/i });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("los partes cerrados no ofrecen acciones", async () => {
    setup();
    await screen.findByText("Grifo gotea");
    fireEvent.click(within(screen.getByRole("group", { name: /filtrar por estado/i })).getByRole("button", { name: /^cerrado$/i }));
    const card = within(await screen.findByRole("article", { name: "Ascensor" }));
    expect(card.queryByRole("button")).toBeNull();
  });

  it("un parte con foto la muestra con una URL firmada de caducidad corta del bucket privado", async () => {
    const withPhoto = [{ ...TICKETS[0], photo_path: `${ORG}/foto-1.jpg` }];
    const fake = setup({ tables: { maintenance_tickets: withPhoto } });
    const card = within(await screen.findByRole("article", { name: "Grifo gotea" }));
    const img = (await card.findByRole("img", { name: /foto del parte/i })) as HTMLImageElement;
    expect(img.src).toContain(`https://storage.test/ticket-photos/${ORG}/foto-1.jpg`);
    expect(fake.signedUrls).toEqual([{ bucket: "ticket-photos", path: `${ORG}/foto-1.jpg`, expiresIn: PHOTO_URL_TTL_SECONDS }]);
    expect(PHOTO_URL_TTL_SECONDS).toBeGreaterThan(0);
    expect(PHOTO_URL_TTL_SECONDS).toBeLessThanOrEqual(600);
  });

  it("un parte sin foto no pide URL firmada ni pinta imagen", async () => {
    const fake = setup();
    const card = within(await screen.findByRole("article", { name: "Grifo gotea" }));
    expect(card.queryByRole("img")).toBeNull();
    expect(fake.signedUrls).toHaveLength(0);
  });

  it("si Storage niega la URL (otra org, objeto borrado) lo dice y no rompe la lista", async () => {
    const withPhoto = [{ ...TICKETS[0], photo_path: `${ORG}/foto-1.jpg` }];
    setup({ tables: { maintenance_tickets: withPhoto }, signedUrlError: { message: "Object not found" } });
    const card = within(await screen.findByRole("article", { name: "Grifo gotea" }));
    await card.findByText(/foto no disponible/i);
    expect(card.queryByRole("img")).toBeNull();
  });
});
