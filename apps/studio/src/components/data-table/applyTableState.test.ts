import { describe, it, expect } from "vitest";
import { applyTableState } from "./applyTableState";
import type { ColumnDef } from "./types";

interface Row {
  id: string;
  name: string;
  age: number;
  sex: "m" | "f";
  dob: string; // ISO date
  email: string | null;
  // Full ISO timestamp, unlike dob — mirrors audit's occurredAt, which is what exposed C1: a
  // date-only filter value against a row value that carries a time-of-day component.
  occurredAt: string | null;
}

const cols: ColumnDef<Row>[] = [
  { id: "name", labelKey: "name", accessor: (r) => r.name, type: "text", defaultVisible: true },
  { id: "age",  labelKey: "age",  accessor: (r) => r.age,  type: "number", defaultVisible: true },
  { id: "sex",  labelKey: "sex",  accessor: (r) => r.sex,  type: "enum", defaultVisible: true,
    enumOptions: [{ value: "m", label: "m" }, { value: "f", label: "f" }] },
  { id: "dob",  labelKey: "dob",  accessor: (r) => r.dob,  type: "date", defaultVisible: true },
  { id: "email", labelKey: "email", accessor: (r) => r.email ?? "", type: "text", defaultVisible: false },
  { id: "occurredAt", labelKey: "occurredAt", accessor: (r) => r.occurredAt ?? "", type: "date", defaultVisible: false },
];

const rows: Row[] = [
  { id: "1", name: "Achieng",  age: 36, sex: "f", dob: "1990-05-12", email: "a@x.com", occurredAt: "2026-08-06T01:18:19.491Z" },
  { id: "2", name: "Kimaro",   age: 41, sex: "m", dob: "1985-07-22", email: null,      occurredAt: "2026-08-06T23:59:59.999Z" },
  { id: "3", name: "Mwangi",   age: 48, sex: "f", dob: "1978-03-10", email: "m@x.com", occurredAt: null },
  { id: "4", name: "Noor",     age: 25, sex: "m", dob: "2001-11-05", email: null,      occurredAt: "2026-08-07T00:00:00.000Z" },
  { id: "5", name: "Santos",   age: 31, sex: "f", dob: "1995-06-30", email: "s@x.com", occurredAt: "2026-08-05T12:00:00.000Z" },
];

describe("applyTableState", () => {
  it("returns all rows + correct total when no filters/sorts apply", () => {
    const res = applyTableState(rows, { filters: [], sorts: [], page: 0, pageSize: 10 }, cols);
    expect(res.total).toBe(5);
    expect(res.rows.map((r) => r.id)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("filters by eq on enum", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "sex", operator: "eq", value: "f", combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    expect(res.total).toBe(3);
    expect(res.rows.every((r) => r.sex === "f")).toBe(true);
  });

  it("filters by like (case-insensitive substring)", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "name", operator: "like", value: "wa", combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    // Mwangi matches "wa"
    expect(res.rows.map((r) => r.name)).toEqual(["Mwangi"]);
  });

  it("between on numeric column", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "age", operator: "between", value: ["30", "45"], combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    expect(res.rows.map((r) => r.name).sort()).toEqual(["Achieng", "Kimaro", "Santos"]);
  });

  it("between on date column (ISO strings)", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "dob", operator: "between", value: ["1990-01-01", "2000-12-31"], combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    expect(res.rows.map((r) => r.name).sort()).toEqual(["Achieng", "Santos"]);
  });

  // C1: a date-only "eq"/"ne"/"between" filter on a column whose row values carry a
  // time-of-day (occurredAt, unlike dob) must select the whole day, not just literal midnight —
  // this is the client-side half of the server SQL fix in table-query-sql.ts.
  it("eq on a date-only value matches every row on that day, not just literal midnight", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "occurredAt", operator: "eq", value: "2026-08-06", combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    expect(res.rows.map((r) => r.name).sort()).toEqual(["Achieng", "Kimaro"]);
  });

  it("ne on a date-only value excludes that whole day but keeps a null row", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "occurredAt", operator: "ne", value: "2026-08-06", combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    expect(res.rows.map((r) => r.name).sort()).toEqual(["Mwangi", "Noor", "Santos"]);
  });

  it("between with date-only bounds includes the end day in full", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "occurredAt", operator: "between", value: ["2026-08-06", "2026-08-06"], combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    expect(res.rows.map((r) => r.name).sort()).toEqual(["Achieng", "Kimaro"]);
  });

  // C1 (fix-wave 2): a *full-timestamp* eq/ne value on a date column is reachable — the CLI's
  // `--where` flag passes one straight through (packages/cli/src/table-query-flags.ts). It must
  // compare as an instant (parseDateMs), not the plain string equality every other eq/ne uses:
  // two ISO strings can name the same instant with different text.
  it("eq on a full-timestamp value matches only that exact instant", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "occurredAt", operator: "eq", value: "2026-08-06T01:18:19.491Z", combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    expect(res.rows.map((r) => r.name)).toEqual(["Achieng"]);
  });

  it("ne on a full-timestamp value excludes only that exact instant but keeps a null row", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "occurredAt", operator: "ne", value: "2026-08-06T01:18:19.491Z", combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    expect(res.rows.map((r) => r.name).sort()).toEqual(["Kimaro", "Mwangi", "Noor", "Santos"]);
  });

  it("is_null matches null and empty string", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "email", operator: "is_null", value: "", combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    expect(res.rows.map((r) => r.name).sort()).toEqual(["Kimaro", "Noor"]);
  });

  it("combines AND + OR in the order given", () => {
    const res = applyTableState(rows, {
      filters: [
        { id: "a", column: "sex", operator: "eq", value: "f", combine: "and" },
        { id: "b", column: "age", operator: "gt", value: "40", combine: "and" },  // sex=f AND age>40 -> Mwangi
        { id: "c", column: "name", operator: "eq", value: "Noor", combine: "or" }, // OR name=Noor
      ],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    expect(res.rows.map((r) => r.name).sort()).toEqual(["Mwangi", "Noor"]);
  });

  it("sorts ascending by numeric age", () => {
    const res = applyTableState(rows, {
      filters: [],
      sorts: [{ id: "s", column: "age", ascending: true }],
      page: 0, pageSize: 10,
    }, cols);
    expect(res.rows.map((r) => r.name)).toEqual(["Noor", "Santos", "Achieng", "Kimaro", "Mwangi"]);
  });

  it("sorts descending by ISO date (dob)", () => {
    const res = applyTableState(rows, {
      filters: [],
      sorts: [{ id: "s", column: "dob", ascending: false }],
      page: 0, pageSize: 10,
    }, cols);
    expect(res.rows[0]!.name).toBe("Noor"); // 2001 — most recent
  });

  it("paginates: respects page + pageSize and reports full total", () => {
    const p1 = applyTableState(rows, { filters: [], sorts: [{ id: "s", column: "name", ascending: true }], page: 0, pageSize: 2 }, cols);
    const p2 = applyTableState(rows, { filters: [], sorts: [{ id: "s", column: "name", ascending: true }], page: 1, pageSize: 2 }, cols);
    expect(p1.total).toBe(5);
    expect(p1.rows.map((r) => r.name)).toEqual(["Achieng", "Kimaro"]);
    expect(p2.rows.map((r) => r.name)).toEqual(["Mwangi", "Noor"]);
  });

  it("accepts a valueGetter override (e.g. for computed columns)", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "initial", operator: "eq", value: "K", combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, [
      ...cols,
      { id: "initial", labelKey: "initial", accessor: (r: Row) => r.name[0], type: "text", defaultVisible: false },
    ], {
      initial: (r) => r.name.charAt(0),
    });
    expect(res.rows.map((r) => r.name)).toEqual(["Kimaro"]);
  });

  it("breaks ties by id, matching the server's appended tiebreaker", () => {
    const tieRows = [
      { id: "c", name: "same" },
      { id: "a", name: "same" },
      { id: "b", name: "same" },
    ];
    const tieCols: ColumnDef<{ id: string; name: string }>[] = [
      { id: "name", labelKey: "name", accessor: (r) => r.name, type: "text", defaultVisible: true },
    ];
    const res = applyTableState(
      tieRows,
      { filters: [], sorts: [{ id: "s", column: "name", ascending: true }], page: 0, pageSize: 10 },
      tieCols,
    );
    expect(res.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves tie order untouched when rows have no id field", () => {
    const noIdRows = [
      { name: "same", tag: "c" },
      { name: "same", tag: "a" },
      { name: "same", tag: "b" },
    ];
    const noIdCols: ColumnDef<{ name: string; tag: string }>[] = [
      { id: "name", labelKey: "name", accessor: (r) => r.name, type: "text", defaultVisible: true },
    ];
    const res = applyTableState(
      noIdRows,
      { filters: [], sorts: [{ id: "s", column: "name", ascending: true }], page: 0, pageSize: 10 },
      noIdCols,
    );
    // No `id` field to break the tie on: stable sort keeps original input order.
    expect(res.rows.map((r) => r.tag)).toEqual(["c", "a", "b"]);
  });
});
