import { describe, it, expect } from "vitest";
import { AUDIT_COLUMNS, FACILITY_COLUMNS, AUDIT_TIEBREAKER, DATE_OPS } from "./columns";

describe("column maps", () => {
  it("names the physical column for every entry in both maps", () => {
    for (const map of [AUDIT_COLUMNS, FACILITY_COLUMNS]) {
      for (const [id, spec] of Object.entries(map)) {
        expect(spec.sql, `${id} must name a SQL column`).toMatch(/^[a-z_][a-z0-9_]*$/);
        expect(spec.operators.length, `${id} must allow at least one operator`).toBeGreaterThan(0);
      }
    }
  });

  it("offers is_null/is_not_null on date columns, matching what the UI's validOperators('date') offers", () => {
    // apps/studio/src/components/data-table/FilterPopover.tsx derives the operator list it shows
    // from validOperators(col.type), not from this map. If this map runs fewer null operators than
    // the UI offers, the UI lets the user pick an operator the server's parser then rejects.
    expect(DATE_OPS).toContain("is_null");
    expect(DATE_OPS).toContain("is_not_null");
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

  it("carries every filter the facility list route already accepts", () => {
    // These three are named params on FacilityListOptions and filters on the page today.
    // Omitting them from the map means the toolbar cannot offer what the page already does.
    for (const id of ["source", "managedOrigin", "registerState"]) {
      expect(FACILITY_COLUMNS[id], `FACILITY_COLUMNS is missing "${id}"`).toBeDefined();
    }
    expect(FACILITY_COLUMNS.source!.sql).toBe("source");
    expect(FACILITY_COLUMNS.managedOrigin!.sql).toBe("managed_origin");
    expect(FACILITY_COLUMNS.registerState!.sql).toBe("register_state");
  });
});
