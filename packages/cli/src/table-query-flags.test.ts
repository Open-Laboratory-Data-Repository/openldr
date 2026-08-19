import { describe, it, expect } from "vitest";
import { parseWhereFlags } from "./table-query-flags";
import { AUDIT_COLUMNS } from "@openldr/table-query";

const ok = (r: ReturnType<typeof parseWhereFlags>) => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.query;
};

describe("parseWhereFlags", () => {
  it("parses a where flag into a rule", () => {
    expect(ok(parseWhereFlags(["action:eq:form.create"], [], AUDIT_COLUMNS)).filters).toEqual([
      { column: "action", operator: "eq", value: "form.create", combine: "and" },
    ]);
  });

  it("keeps colons in the value", () => {
    // entityIds and URLs contain colons; only the first two are delimiters.
    expect(ok(parseWhereFlags(["entityId:eq:urn:tz:hfr"], [], AUDIT_COLUMNS)).filters[0]!.value).toBe("urn:tz:hfr");
  });

  it("reads a leading dash as descending", () => {
    expect(ok(parseWhereFlags([], ["-occurredAt"], AUDIT_COLUMNS)).sorts).toEqual([
      { column: "occurredAt", ascending: false },
    ]);
    expect(ok(parseWhereFlags([], ["action"], AUDIT_COLUMNS)).sorts).toEqual([
      { column: "action", ascending: true },
    ]);
  });

  it("rejects an unknown column the same way the route does", () => {
    const r = parseWhereFlags(["password:eq:x"], [], AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("password");
  });

  it("rejects a malformed where flag", () => {
    expect(parseWhereFlags(["justacolumn"], [], AUDIT_COLUMNS).ok).toBe(false);
  });
});
