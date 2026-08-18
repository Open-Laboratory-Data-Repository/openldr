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
});
