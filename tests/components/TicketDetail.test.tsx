// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../harness/fake-supabase";

const state = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => state.fake,
}));

import { TicketDetail } from "@/components/tickets/TicketDetail";

const ORG = "00000000-0000-0000-0000-00000000000a";
const TICKET = {
  id: "t1", org_id: ORG, title: "Grifo gotea", description: "Baño 101", priority: "normal",
  status: "abierto", created_by: "user-a", created_at: "2026-01-01T10:00:00Z",
};

type RpcError = { message: string; code?: string };

function setup(error: RpcError | null, data: unknown = error ? null : true) {
  state.fake = new FakeSupabase({
    user: { id: "user-mant" },
    tables: { maintenance_tickets: [TICKET], ticket_updates: [] },
    rpcResults: {
      change_ticket_status: { data, error },
      ticket_author_emails: { data: [], error: null },
    },
  });
  render(<TicketDetail orgId={ORG} ticketId="t1" />);
  return state.fake;
}

afterEach(cleanup);

async function clickInProgress() {
  fireEvent.click(await screen.findByRole("button", { name: /poner en curso/i }));
  return screen.findByRole("alert");
}

describe("TicketDetail: errores de change_ticket_status", () => {
  it("un error sin código da el genérico y nunca el texto del servidor", async () => {
    setup({ message: "permission denied for table maintenance_tickets" });
    const alert = await clickInProgress();
    expect(alert.textContent).toMatch(/no se pudo cambiar el estado/i);
    expect(alert.textContent).not.toMatch(/permission|maintenance_tickets/);
  });

  it("42501 pide volver a iniciar sesión, sin el texto del servidor", async () => {
    setup({ code: "42501", message: "authentication required" });
    const alert = await clickInProgress();
    expect(alert.textContent).toMatch(/vuelve a iniciar sesión/i);
    expect(alert.textContent).not.toMatch(/authentication/);
    expect(alert.textContent).toMatch(/no tienes acceso a este parte o tu sesión caducó/i);
  });

  it("22023 dice que el cambio no está permitido, sin el texto del servidor", async () => {
    setup({ code: "22023", message: "invalid ticket status transition: abierto -> en_curso" });
    const alert = await clickInProgress();
    expect(alert.textContent).toMatch(/no está permitido/i);
    expect(alert.textContent).not.toMatch(/invalid|transition/);
  });

  it("si otro dispositivo ya lo cambió (false), avisa y recarga", async () => {
    const fake = setup(null, false);
    const alert = await clickInProgress();
    expect(alert.textContent).toMatch(/cambió de estado/i);
    await waitFor(() => expect(fake.callsTo("maintenance_tickets", "select")).toHaveLength(2));
  });
});
