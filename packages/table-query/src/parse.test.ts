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
    const r = parseTableQuery(raw, columns);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("action");
  });

  it("rejects malformed JSON rather than treating it as empty", () => {
    const r = parseTableQuery({ filters: "{not json" }, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not valid JSON/i);
  });

  it("rejects an oversized payload", () => {
    const r = parseTableQuery({ filters: "x".repeat(MAX_QUERY_CHARS + 1) }, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too (large|long)/i);
  });

  it("rejects too many rules", () => {
    const many = Array.from({ length: 26 }, () => ({ column: "action", operator: "eq", value: "a", combine: "and" }));
    const r = parseTableQuery({ filters: JSON.stringify(many) }, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too many/i);
  });

  it("rejects a between rule whose value is not a 2-element array", () => {
    const raw = { filters: JSON.stringify([{ column: "occurredAt", operator: "between", value: "2026-01-01", combine: "and" }]) };
    const r = parseTableQuery(raw, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/between/i);
  });

  // --- Critical 1: prototype-chain column lookup must reject, not throw ---

  it("rejects __proto__ as a filter column instead of crashing", () => {
    const raw = { filters: JSON.stringify([{ column: "__proto__", operator: "eq", value: "x", combine: "and" }]) };
    expect(() => parseTableQuery(raw, AUDIT_COLUMNS)).not.toThrow();
    const r = parseTableQuery(raw, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("__proto__");
  });

  it("rejects constructor as a filter column instead of crashing", () => {
    const raw = { filters: JSON.stringify([{ column: "constructor", operator: "eq", value: "x", combine: "and" }]) };
    expect(() => parseTableQuery(raw, AUDIT_COLUMNS)).not.toThrow();
    const r = parseTableQuery(raw, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("constructor");
  });

  it("rejects __proto__ as a sort column instead of crashing", () => {
    const raw = { sorts: JSON.stringify([{ column: "__proto__", ascending: true }]) };
    expect(() => parseTableQuery(raw, AUDIT_COLUMNS)).not.toThrow();
    const r = parseTableQuery(raw, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("__proto__");
  });

  // --- Critical 2: a null array entry must reject, not throw ---

  it("rejects a null filter entry instead of crashing", () => {
    const raw = { filters: JSON.stringify([null]) };
    expect(() => parseTableQuery(raw, AUDIT_COLUMNS)).not.toThrow();
    const r = parseTableQuery(raw, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it("rejects a null sort entry instead of crashing", () => {
    const raw = { sorts: JSON.stringify([null]) };
    expect(() => parseTableQuery(raw, AUDIT_COLUMNS)).not.toThrow();
    const r = parseTableQuery(raw, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  // --- Important 3: the size cap is on the combined encoded length ---

  it("rejects a combined payload over the cap split across filters and sorts", () => {
    // Each half is under MAX_QUERY_CHARS alone, but together they exceed it.
    const half = Math.floor(MAX_QUERY_CHARS / 2) + 100;
    const raw = { filters: "x".repeat(half), sorts: "x".repeat(half) };
    const r = parseTableQuery(raw, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too (large|long)/i);
  });

  // --- Important 4: combine must be "and"/"or" only, never coerced ---

  it("rejects an unrecognised combine value instead of coercing to and", () => {
    const raw = { filters: JSON.stringify([{ column: "action", operator: "eq", value: "x", combine: "xyz" }]) };
    const r = parseTableQuery(raw, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("xyz");
  });

  it("treats a missing combine as and", () => {
    const raw = { filters: JSON.stringify([{ column: "action", operator: "eq", value: "x" }]) };
    expect(ok(parseTableQuery(raw, AUDIT_COLUMNS)).filters).toEqual([
      { column: "action", operator: "eq", value: "x", combine: "and" },
    ]);
  });

  // --- Important 5: a bad value on a typed column is a 400 from the parser, not a Postgres
  // 500. Verified live: gte "abc" against a timestamptz column throws "invalid input syntax
  // for type timestamp with time zone"; a between pair with one empty box throws the same for
  // "". Validation belongs at the parse boundary, not the SQL translator. ---

  const NUMBER_COLUMNS = {
    ...AUDIT_COLUMNS,
    weight: { sql: "weight", type: "number" as const, operators: ["eq", "ne", "gt", "gte", "lt", "lte", "between", "is_null", "is_not_null"] as const, sortable: true },
  };

  it("rejects a non-numeric value on a number column, naming the column and the value", () => {
    const raw = { filters: JSON.stringify([{ column: "weight", operator: "gte", value: "abc", combine: "and" }]) };
    const r = parseTableQuery(raw, NUMBER_COLUMNS as never);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toContain("weight"); expect(r.error).toContain("abc"); }
  });

  it("rejects an empty string on a number column", () => {
    const raw = { filters: JSON.stringify([{ column: "weight", operator: "eq", value: "", combine: "and" }]) };
    const r = parseTableQuery(raw, NUMBER_COLUMNS as never);
    expect(r.ok).toBe(false);
  });

  it("accepts a finite number value on a number column", () => {
    const raw = { filters: JSON.stringify([{ column: "weight", operator: "gte", value: "42", combine: "and" }]) };
    expect(ok(parseTableQuery(raw, NUMBER_COLUMNS as never)).filters).toEqual([
      { column: "weight", operator: "gte", value: "42", combine: "and" },
    ]);
  });

  it("rejects a non-numeric element inside a between pair on a number column", () => {
    const raw = { filters: JSON.stringify([{ column: "weight", operator: "between", value: ["1", "abc"], combine: "and" }]) };
    const r = parseTableQuery(raw, NUMBER_COLUMNS as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("weight");
  });

  it("rejects an unparseable date value on a date column", () => {
    const raw = { filters: JSON.stringify([{ column: "occurredAt", operator: "gte", value: "abc", combine: "and" }]) };
    const r = parseTableQuery(raw, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toContain("occurredAt"); expect(r.error).toContain("abc"); }
  });

  it("rejects a between pair on a date column when one box is empty", () => {
    // Reachable straight from the UI: a between widget with only the first box filled.
    const raw = { filters: JSON.stringify([{ column: "occurredAt", operator: "between", value: ["2026-08-18", ""], combine: "and" }]) };
    const r = parseTableQuery(raw, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("occurredAt");
  });

  it("accepts a parseable date value on a date column", () => {
    const raw = { filters: JSON.stringify([{ column: "occurredAt", operator: "gte", value: "2026-08-18", combine: "and" }]) };
    expect(ok(parseTableQuery(raw, AUDIT_COLUMNS)).filters).toEqual([
      { column: "occurredAt", operator: "gte", value: "2026-08-18", combine: "and" },
    ]);
  });

  it("does not require a value for is_null on a date column", () => {
    const raw = { filters: JSON.stringify([{ column: "occurredAt", operator: "is_null", value: "", combine: "and" }]) };
    expect(ok(parseTableQuery(raw, AUDIT_COLUMNS)).filters).toEqual([
      { column: "occurredAt", operator: "is_null", value: "", combine: "and" },
    ]);
  });

  it("still lets like with an empty needle through on a text column (deliberate match-everything)", () => {
    const raw = { filters: JSON.stringify([{ column: "action", operator: "like", value: "", combine: "and" }]) };
    expect(ok(parseTableQuery(raw, AUDIT_COLUMNS)).filters).toEqual([
      { column: "action", operator: "like", value: "", combine: "and" },
    ]);
  });

  it("rejects a date Postgres cannot parse, even though Date.parse accepts it", () => {
    // Date.parse("2026") is valid; `select '2026'::timestamptz` is an error. Accepting it here
    // turns a user's bad input into a 500 instead of a 400.
    for (const bad of ["2026", "2026-08"]) {
      const raw = { filters: JSON.stringify([{ column: "occurredAt", operator: "gte", value: bad, combine: "and" }]) };
      const r = parseTableQuery(raw, AUDIT_COLUMNS);
      expect(r.ok, `expected "${bad}" to be rejected`).toBe(false);
      if (!r.ok) expect(r.error).toContain(bad);
    }
  });

  it("accepts the date forms Postgres does parse", () => {
    for (const good of ["2026-08-18", "2026-08-18T12:00:00Z", "2026-08-18 12:00:00+03"]) {
      const raw = { filters: JSON.stringify([{ column: "occurredAt", operator: "gte", value: good, combine: "and" }]) };
      expect(parseTableQuery(raw, AUDIT_COLUMNS).ok, `expected "${good}" to be accepted`).toBe(true);
    }
  });
});
