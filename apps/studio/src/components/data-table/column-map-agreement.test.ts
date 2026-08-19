import { describe, it, expect } from "vitest";
import { AUDIT_COLUMNS, FACILITY_COLUMNS, type TableColumnMap } from "@openldr/table-query";
import { validOperators } from "./types";

// The server's column map is the authority. The UI may offer FEWER operators than the type
// allows, never more — offering more produces a 400 the user cannot act on. Nothing enforced
// this agreement before, which is how AUDIT_COLUMNS.id drifted.
const MAPS: [string, TableColumnMap][] = [["AUDIT_COLUMNS", AUDIT_COLUMNS], ["FACILITY_COLUMNS", FACILITY_COLUMNS]];

describe("column maps agree with what the UI can offer", () => {
  for (const [label, map] of MAPS) {
    it(`${label}: every allowed operator is valid for the column's type`, () => {
      for (const [id, spec] of Object.entries(map)) {
        const allowedByType = validOperators(spec.type);
        for (const op of spec.operators) {
          expect(allowedByType, `${label}.${id} allows "${op}" but type "${spec.type}" does not`).toContain(op);
        }
      }
    });

  }
});
