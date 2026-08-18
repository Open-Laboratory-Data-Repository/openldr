import { describe, it, expect } from "vitest";
import { AUDIT_COLUMNS, FACILITY_COLUMNS, AUDIT_TIEBREAKER } from "./columns";

describe("column maps", () => {
  it("names the physical column for every audit entry", () => {
    for (const [id, spec] of Object.entries(AUDIT_COLUMNS)) {
      expect(spec.sql, `${id} must name a SQL column`).toMatch(/^[a-z_][a-z0-9_]*$/);
      expect(spec.operators.length, `${id} must allow at least one operator`).toBeGreaterThan(0);
    }
  });

  it("includes the tiebreaker as a sortable column", () => {
    expect(AUDIT_COLUMNS[AUDIT_TIEBREAKER]).toBeDefined();
    expect(AUDIT_COLUMNS[AUDIT_TIEBREAKER]!.sortable).toBe(true);
  });

  it("allows range operators only on date and number columns", () => {
    for (const map of [AUDIT_COLUMNS, FACILITY_COLUMNS]) {
      for (const [id, spec] of Object.entries(map)) {
        if (spec.operators.includes("between")) {
          expect(["date", "number"], `${id} allows between`).toContain(spec.type);
        }
      }
    }
  });
});
