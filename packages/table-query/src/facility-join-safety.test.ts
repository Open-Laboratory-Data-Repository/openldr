import { describe, it, expect } from "vitest";
import { FACILITY_COLUMNS } from "./columns";

// The grammar emits UNQUALIFIED column references (sql.ref("name")). The facility list query
// joins facility_concept_projection and a derived aggregate, so a mapped sql name that also
// exists on a joined table makes every query ambiguous and 500s.
//
// Checked live at design time: facility_concept_projection has exactly registry_id,
// concept_code, updated_at; the derived table exposes to_code and n. `updated_at` is the live
// wire here -- it exists on facility_registry TOO, so mapping it would break everything.
const JOINED_TABLE_COLUMNS = ["registry_id", "concept_code", "updated_at", "to_code", "n"];

describe("FACILITY_COLUMNS is safe against the list query's joins", () => {
  it("maps no column name that a joined table also exposes", () => {
    for (const [id, spec] of Object.entries(FACILITY_COLUMNS)) {
      expect(
        JOINED_TABLE_COLUMNS,
        `FACILITY_COLUMNS.${id} maps "${spec.sql}", which a joined table also exposes — ` +
          `unqualified references would be ambiguous`,
      ).not.toContain(spec.sql);
    }
  });
});
