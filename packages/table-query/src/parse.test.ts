import { describe, it, expect } from "vitest";
import { parseTableQuery, MAX_QUERY_CHARS } from "./parse";
import { AUDIT_COLUMNS } from "./columns";

const ok = (r: ReturnType<typeof parseTableQuery>) => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.query;
};

describe("parseTableQuery", () => {
  it("returns an empty query when nothing is supplied", () => {
    expect(ok(parseTableQuery({}, AUDIT_COLUMNS))).toEqual({ filters: [], sorts: [] });
  });

  it("parses a valid filter and strips the client-only id", () => {
    const raw = { filters: JSON.stringify([{ id: "f1", column: "action", operator: "eq", value: "login", combine: "and" }]) };
    expect(ok(parseTableQuery(raw, AUDIT_COLUMNS)).filters).toEqual([
      { column: "action", operator: "eq", value: "login", combine: "and" },
    ]);
  });

  it("rejects a column that is not in the map, naming it", () => {
    const raw = { filters: JSON.stringify([{ column: "password", operator: "eq", value: "x", combine: "and" }]) };
    const r = parseTableQuery(raw, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("password");
  });

  it("rejects an operator the column does not allow, naming it", () => {
    // occurredAt is a date column: `like` is not in DATE_OPS
    const raw = { filters: JSON.stringify([{ column: "occurredAt", operator: "like", value: "x", combine: "and" }]) };
    const r = parseTableQuery(raw, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("like");
  });

  it("rejects sorting an unsortable column", () => {
    const columns = { ...AUDIT_COLUMNS, action: { ...AUDIT_COLUMNS.action!, sortable: false } };
    const raw = { sorts: JSON.stringify([{ column: "action", ascending: true }]) };
    expect(parseTableQuery(raw, columns).ok).toBe(false);
  });

  it("rejects malformed JSON rather than treating it as empty", () => {
    const r = parseTableQuery({ filters: "{not json" }, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
  });

  it("rejects an oversized payload", () => {
    const r = parseTableQuery({ filters: "x".repeat(MAX_QUERY_CHARS + 1) }, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too (large|long)/i);
  });

  it("rejects too many rules", () => {
    const many = Array.from({ length: 26 }, () => ({ column: "action", operator: "eq", value: "a", combine: "and" }));
    expect(parseTableQuery({ filters: JSON.stringify(many) }, AUDIT_COLUMNS).ok).toBe(false);
  });

  it("rejects a between rule whose value is not a 2-element array", () => {
    const raw = { filters: JSON.stringify([{ column: "occurredAt", operator: "between", value: "2026-01-01", combine: "and" }]) };
    expect(parseTableQuery(raw, AUDIT_COLUMNS).ok).toBe(false);
  });
});
