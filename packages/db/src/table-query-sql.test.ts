import { describe, it, expect } from "vitest";
import { newDb } from "pg-mem";
import type { Kysely } from "kysely";
import { applySorts, buildFilterExpression } from "./table-query-sql";
import type { TableColumnMap } from "@openldr/table-query";

const COLUMNS: TableColumnMap = {
  id:     { sql: "id",     type: "text", operators: ["eq", "in"], sortable: true },
  name:   { sql: "name",   type: "text", operators: ["eq", "ne", "like", "in", "is_null", "is_not_null"], sortable: true },
  weight: { sql: "weight", type: "number", operators: ["gt", "gte", "lt", "lte", "between"], sortable: true },
};

// Same pg-mem-backed-Kysely harness packages/dashboards/src/store.test.ts uses for an ad hoc table:
// `newDb()` + `mem.adapters.createKysely()`, no migrations needed since this test owns its own table.
function makeDb(): Kysely<any> {
  const mem = newDb();
  return mem.adapters.createKysely();
}

// Rows: one with a NULL name, to pin the coalesce behaviour the client requires.
async function seed(db: Kysely<any>) {
  await db.schema.createTable("t").addColumn("id", "text").addColumn("name", "text").addColumn("weight", "integer").execute();
  await db.insertInto("t").values([
    { id: "1", name: "alpha",  weight: 10 },
    { id: "2", name: "BETA",   weight: 5 },
    { id: "3", name: null,     weight: 1 },
  ]).execute();
}

async function idsMatching(db: Kysely<any>, filters: any[]): Promise<string[]> {
  const rows = await db.selectFrom("t").select("id")
    .where((eb: any) => buildFilterExpression(eb, filters, COLUMNS) ?? eb.val(true))
    .orderBy("id").execute();
  return rows.map((r: any) => r.id);
}

describe("buildFilterExpression", () => {
  it("ne includes a NULL row, matching the client", async () => {
    // client: String(null ?? "") !== "alpha" -> true. Plain SQL `name <> 'alpha'` would drop row 3.
    const db = makeDb(); await seed(db);
    expect(await idsMatching(db, [{ column: "name", operator: "ne", value: "alpha", combine: "and" }])).toEqual(["2", "3"]);
  });

  it("like is case-insensitive substring", async () => {
    const db = makeDb(); await seed(db);
    expect(await idsMatching(db, [{ column: "name", operator: "like", value: "bet", combine: "and" }])).toEqual(["2"]);
  });

  it("like with an empty needle matches everything", async () => {
    const db = makeDb(); await seed(db);
    expect(await idsMatching(db, [{ column: "name", operator: "like", value: "", combine: "and" }])).toEqual(["1", "2", "3"]);
  });

  it("in with an empty set matches nothing", async () => {
    const db = makeDb(); await seed(db);
    expect(await idsMatching(db, [{ column: "name", operator: "in", value: [], combine: "and" }])).toEqual([]);
  });

  it("in with a non-empty set matches any listed value", async () => {
    const db = makeDb(); await seed(db);
    expect(await idsMatching(db, [{ column: "name", operator: "in", value: ["alpha", "BETA"], combine: "and" }])).toEqual(["1", "2"]);
  });

  it("is_null treats an empty string as null", async () => {
    const db = makeDb(); await seed(db);
    expect(await idsMatching(db, [{ column: "name", operator: "is_null", value: "", combine: "and" }])).toEqual(["3"]);
  });

  it("folds left to right: A AND B OR C", async () => {
    const db = makeDb(); await seed(db);
    const ids = await idsMatching(db, [
      { column: "name",   operator: "eq", value: "alpha", combine: "and" },
      { column: "weight", operator: "gt", value: "100",   combine: "and" },
      { column: "name",   operator: "eq", value: "BETA",  combine: "or"  },
    ]);
    // (alpha AND weight>100) OR BETA  ->  just row 2
    expect(ids).toEqual(["2"]);
  });

  it("folds left to right the OTHER way too: A OR B AND C", async () => {
    const db = makeDb(); await seed(db);
    const ids = await idsMatching(db, [
      { column: "name",   operator: "eq", value: "alpha", combine: "and" },
      { column: "name",   operator: "eq", value: "BETA",  combine: "or"  },
      { column: "weight", operator: "gt", value: "100",   combine: "and" },
    ]);
    // (alpha OR BETA) AND weight>100 -> nothing (10 and 5 both <= 100).
    // A naive right-associative or unparenthesized fold could instead compute
    // alpha OR (BETA AND weight>100), which would keep row 1.
    expect(ids).toEqual([]);
  });

  it("is_null's internal OR stays correctly grouped inside an AND fold (parens matter)", async () => {
    // A rule expression that itself contains an internal OR (is_null: "col is null or col = ''")
    // must be atomic when it becomes an operand of a later AND/OR fold step. Kysely's eb.and/eb.or
    // parenthesize the OUTER combination, not each operand's own internals — so an unparenthesized
    // is_null clause can silently regroup with its neighbour.
    const db = makeDb();
    await db.schema.createTable("t").addColumn("id", "text").addColumn("name", "text").addColumn("weight", "integer").execute();
    await db.insertInto("t").values([
      { id: "1", name: "alpha", weight: 10 },
      { id: "2", name: "BETA",  weight: 5 },
      { id: "3", name: null,    weight: 1 },
      { id: "4", name: "",      weight: 2 },
    ]).execute();
    const ids = await idsMatching(db, [
      { column: "weight", operator: "gt",      value: "5", combine: "and" },
      { column: "name",   operator: "is_null", value: "",  combine: "and" },
    ]);
    // Correct: weight>5 AND (name is null OR name=''). No row satisfies both halves.
    // A buggy unparenthesized fold instead computes (weight>5 AND name is null) OR name='',
    // which wrongly keeps row 4 (name === '') regardless of its weight.
    expect(ids).toEqual([]);
  });

  it("between is inclusive on both ends", async () => {
    const db = makeDb(); await seed(db);
    expect(await idsMatching(db, [{ column: "weight", operator: "between", value: ["5", "10"], combine: "and" }])).toEqual(["1", "2"]);
  });

  // DEFERRED to Task 6's live-Postgres test: pg-mem's SQL parser does not support the ILIKE
  // ... ESCAPE clause at all (a hard syntax error, not a semantic mismatch — see the report),
  // and this is the one case that must emit it, so pg-mem can never run this assertion.
  // it("escapes LIKE wildcards so they match literally", async () => {
  //   const db = makeDb();
  //   await db.schema.createTable("t").addColumn("id", "text").addColumn("name", "text").addColumn("weight", "integer").execute();
  //   await db.insertInto("t").values([{ id: "1", name: "50%", weight: 1 }, { id: "2", name: "5000", weight: 1 }]).execute();
  //   expect(await idsMatching(db, [{ column: "name", operator: "like", value: "50%", combine: "and" }])).toEqual(["1"]);
  // });
});

describe("applySorts", () => {
  it("applies each sort in order and always appends the tiebreaker", async () => {
    const db = makeDb(); await seed(db);
    const rows = await applySorts(
      db.selectFrom("t").select(["id"]),
      [{ column: "weight", ascending: true }],
      COLUMNS,
      "name",
    ).execute();
    // weight asc: row3(1), row2(5), row1(10). "name" tiebreaker only matters on ties, which
    // this data has none of, but must not error and must not change the primary order.
    expect(rows.map((r: any) => r.id)).toEqual(["3", "2", "1"]);
  });

  it("the tiebreaker breaks ties deterministically when the sort key repeats", async () => {
    const db = makeDb();
    await db.schema.createTable("t").addColumn("id", "text").addColumn("name", "text").addColumn("weight", "integer").execute();
    await db.insertInto("t").values([
      { id: "z", name: "same", weight: 1 },
      { id: "a", name: "same", weight: 1 },
      { id: "m", name: "same", weight: 1 },
    ]).execute();
    const rows = await applySorts(
      db.selectFrom("t").select(["id"]),
      [{ column: "weight", ascending: true }],
      COLUMNS,
      "id",
    ).execute();
    expect(rows.map((r: any) => r.id)).toEqual(["a", "m", "z"]);
  });
});
