/**
 * Tests for TypeScript interface conformance.
 * These tests verify that objects matching the interface shapes
 * can be constructed without TypeScript errors (compile-time) and
 * that the runtime shape assumptions hold.
 */
import { describe, it, expect } from "vitest";
import type {
  Organization,
  Membership,
  ShiftHandover,
  HandoverItem,
  TicketAsset,
  MaintenanceTicket,
  TicketUpdate,
} from "@/types";
import {
  DEPARTMENTS,
  SHIFT_TYPES,
  HANDOVER_BLOCKS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from "@/types";

// ── Organization ─────────────────────────────────────────────────────────────

describe("Organization interface", () => {
  const org: Organization = {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Hotel Demo",
    status: "active",
    created_at: new Date().toISOString(),
  };

  it("can construct a minimal valid organization", () => {
    expect(org.id).toBeTruthy();
    expect(org.name).toBeTruthy();
    expect(["active", "suspended", "archived"]).toContain(org.status);
  });

  it("status values are exactly active | suspended | archived", () => {
    const validStatuses = ["active", "suspended", "archived"] as const;
    for (const s of validStatuses) {
      const o: Organization = { ...org, status: s };
      expect(o.status).toBe(s);
    }
  });
});

// ── Membership ────────────────────────────────────────────────────────────────

describe("Membership interface", () => {
  const membership: Membership = {
    id: "m1",
    org_id: "o1",
    user_id: "u1",
    role: "staff",
    created_at: new Date().toISOString(),
  };

  it("can construct a minimal membership", () => {
    expect(membership.org_id).toBeTruthy();
    expect(membership.user_id).toBeTruthy();
  });

  it("role values are staff | supervisor | admin", () => {
    const roles = ["staff", "supervisor", "admin"] as const;
    for (const r of roles) {
      const m: Membership = { ...membership, role: r };
      expect(m.role).toBe(r);
    }
  });
});

// ── ShiftHandover ─────────────────────────────────────────────────────────────

describe("ShiftHandover interface", () => {
  const handover: ShiftHandover = {
    id: "h1",
    org_id: "o1",
    department: "recepcion",
    shift_type: "manana",
    created_by: "u1",
    created_at: new Date().toISOString(),
  };

  it("can construct a minimal handover", () => {
    expect(handover.department).toBe("recepcion");
    expect(handover.shift_type).toBe("manana");
    expect(handover.created_by).toBeTruthy();
  });

  it("department values match DEPARTMENTS constant", () => {
    const deptValues = DEPARTMENTS.map((d) => d.value);
    expect(deptValues).toContain(handover.department);
  });

  it("shift_type values match SHIFT_TYPES constant", () => {
    const shiftValues = SHIFT_TYPES.map((s) => s.value);
    expect(shiftValues).toContain(handover.shift_type);
  });

  it("read_by and read_at are optional", () => {
    const withRead: ShiftHandover = { ...handover, read_by: "u2", read_at: new Date().toISOString() };
    expect(withRead.read_by).toBe("u2");
    const noRead: ShiftHandover = { ...handover };
    expect(noRead.read_by).toBeUndefined();
  });
});

// ── HandoverItem ──────────────────────────────────────────────────────────────

describe("HandoverItem interface", () => {
  const item: HandoverItem = {
    id: "i1",
    handover_id: "h1",
    org_id: "o1",
    block: "pendientes",
    content: "Revisar habitación 101",
    resolved: false,
    created_at: new Date().toISOString(),
  };

  it("can construct a minimal handover item", () => {
    expect(item.block).toBe("pendientes");
    expect(item.resolved).toBe(false);
    expect(item.content).toBeTruthy();
  });

  it("block values match HANDOVER_BLOCKS constant", () => {
    const blockValues = HANDOVER_BLOCKS.map((b) => b.value);
    for (const v of blockValues) {
      expect(blockValues).toContain(v);
    }
    expect(blockValues).toContain(item.block);
  });

  it("resolved_by and resolved_at are optional but linked", () => {
    const resolved: HandoverItem = {
      ...item,
      resolved: true,
      resolved_by: "u2",
      resolved_at: new Date().toISOString(),
    };
    expect(resolved.resolved).toBe(true);
    expect(resolved.resolved_by).toBeTruthy();
  });
});

// ── TicketAsset ───────────────────────────────────────────────────────────────

describe("TicketAsset interface", () => {
  const asset: TicketAsset = {
    id: "a1",
    org_id: "o1",
    name: "Ascensor Principal",
    qr_code: "ASSET-LIFT-1",
    created_at: new Date().toISOString(),
  };

  it("can construct a minimal asset", () => {
    expect(asset.qr_code).toBeTruthy();
    expect(asset.name).toBeTruthy();
  });

  it("location is optional", () => {
    const withLocation: TicketAsset = { ...asset, location: "Vestíbulo" };
    expect(withLocation.location).toBe("Vestíbulo");
    const noLocation: TicketAsset = { ...asset };
    expect(noLocation.location).toBeUndefined();
  });
});

// ── MaintenanceTicket ─────────────────────────────────────────────────────────

describe("MaintenanceTicket interface", () => {
  const ticket: MaintenanceTicket = {
    id: "t1",
    org_id: "o1",
    title: "Grifo roto habitación 203",
    priority: "alta",
    status: "abierto",
    created_by: "u1",
    created_at: new Date().toISOString(),
  };

  it("can construct a minimal ticket", () => {
    expect(ticket.title).toBeTruthy();
    expect(ticket.priority).toBe("alta");
    expect(ticket.status).toBe("abierto");
  });

  it("priority values match TICKET_PRIORITIES constant", () => {
    const pValues = TICKET_PRIORITIES.map((p) => p.value);
    expect(pValues).toContain(ticket.priority);
  });

  it("status values match TICKET_STATUSES constant", () => {
    const sValues = TICKET_STATUSES.map((s) => s.value);
    expect(sValues).toContain(ticket.status);
  });

  it("optional fields can be set for closed ticket", () => {
    const closed: MaintenanceTicket = {
      ...ticket,
      status: "cerrado",
      closed_by: "u2",
      closed_at: new Date().toISOString(),
    };
    expect(closed.status).toBe("cerrado");
    expect(closed.closed_by).toBeTruthy();
    expect(closed.closed_at).toBeTruthy();
  });

  it("asset_id, assigned_to, description, photo_path are optional", () => {
    const full: MaintenanceTicket = {
      ...ticket,
      asset_id: "a1",
      assigned_to: "u3",
      description: "El grifo pierde agua constantemente",
      photo_path: "ticket-photos/t1.jpg",
    };
    expect(full.asset_id).toBe("a1");
    expect(full.assigned_to).toBe("u3");
  });
});

// ── TicketUpdate ──────────────────────────────────────────────────────────────

describe("TicketUpdate interface", () => {
  const update: TicketUpdate = {
    id: "u1",
    ticket_id: "t1",
    org_id: "org1",
    status_to: "en_curso",
    created_by: "usr1",
    created_at: new Date().toISOString(),
  };

  it("can construct a minimal update", () => {
    expect(update.ticket_id).toBeTruthy();
    expect(update.status_to).toBe("en_curso");
  });

  it("status_from is optional (first status change has no from)", () => {
    const withFrom: TicketUpdate = { ...update, status_from: "abierto" };
    expect(withFrom.status_from).toBe("abierto");
    expect(update.status_from).toBeUndefined();
  });

  it("comment is optional", () => {
    const withComment: TicketUpdate = { ...update, comment: "Enviado al técnico" };
    expect(withComment.comment).toBe("Enviado al técnico");
  });
});

// ── Cross-constant consistency ────────────────────────────────────────────────

describe("type constants consistency with SQL CHECK constraints", () => {
  it("DEPARTMENTS values match SQL check constraint", () => {
    const sqlValues = ["recepcion", "pisos", "fb", "mantenimiento", "otro"];
    const tsValues = DEPARTMENTS.map((d) => d.value).sort();
    expect(tsValues).toEqual(sqlValues.sort());
  });

  it("SHIFT_TYPES values match SQL check constraint", () => {
    const sqlValues = ["manana", "tarde", "noche"];
    const tsValues = SHIFT_TYPES.map((s) => s.value).sort();
    expect(tsValues).toEqual(sqlValues.sort());
  });

  it("HANDOVER_BLOCKS values match SQL check constraint", () => {
    const sqlValues = ["pendientes", "vips", "incidencias", "avisos"];
    const tsValues = HANDOVER_BLOCKS.map((b) => b.value).sort();
    expect(tsValues).toEqual(sqlValues.sort());
  });

  it("TICKET_PRIORITIES values match SQL check constraint", () => {
    const sqlValues = ["critica", "alta", "normal", "baja"];
    const tsValues = TICKET_PRIORITIES.map((p) => p.value).sort();
    expect(tsValues).toEqual(sqlValues.sort());
  });

  it("TICKET_STATUSES values match SQL check constraint", () => {
    const sqlValues = ["abierto", "en_curso", "cerrado"];
    const tsValues = TICKET_STATUSES.map((s) => s.value).sort();
    expect(tsValues).toEqual(sqlValues.sort());
  });
});
