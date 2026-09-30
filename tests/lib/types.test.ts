import { describe, it, expect } from "vitest";
import {
  DEPARTMENTS,
  SHIFT_TYPES,
  HANDOVER_BLOCKS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from "@/types";

describe("types — constants", () => {
  it("DEPARTMENTS has 5 entries", () => {
    expect(DEPARTMENTS).toHaveLength(5);
  });

  it("SHIFT_TYPES has 3 entries", () => {
    expect(SHIFT_TYPES).toHaveLength(3);
  });

  it("HANDOVER_BLOCKS has 4 entries with required fields", () => {
    expect(HANDOVER_BLOCKS).toHaveLength(4);
    for (const block of HANDOVER_BLOCKS) {
      expect(block.value).toBeTruthy();
      expect(block.label).toBeTruthy();
      expect(block.description).toBeTruthy();
    }
  });

  it("HANDOVER_BLOCKS have unique values", () => {
    const values = HANDOVER_BLOCKS.map((b) => b.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("TICKET_PRIORITIES has 4 entries", () => {
    expect(TICKET_PRIORITIES).toHaveLength(4);
  });

  it("TICKET_STATUSES has 3 entries", () => {
    expect(TICKET_STATUSES).toHaveLength(3);
  });

  it("TICKET_STATUSES has abierto, en_curso, cerrado", () => {
    const values = TICKET_STATUSES.map((s) => s.value).sort();
    expect(values).toEqual(["abierto", "cerrado", "en_curso"]);
  });
});