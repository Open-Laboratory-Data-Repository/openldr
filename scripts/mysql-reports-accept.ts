// Live acceptance for the seeded MYSQL REPORT QUERY VARIANTS.
//
// The gap this closes, stated plainly. Every `mysql:` string in `report-seeds.ts` was written by
// reading the postgres one and translating it. `mysql-live-acceptance.ts` covers the WRITE path and
// says so in its own header ("report queries need MySQL SQL variants that land in a later slice, so
// reporting is intentionally NOT exercised"). The MSSQL harness's reporting step does not run
// dialect SQL against SQL Server either; its comment says it only proves the data-driven path
// resolves. So no harness in this repo has ever executed a seeded mysql query against MySQL, and
// the automated checks that do exist are regexes over SQL TEXT, which by construction cannot see a
// syntax error.
//
// ⛔ Through `createConnectorDb`, NOT the mysql CLI. That distinction is the whole point. The
// transmission queries carried a disclosure for months saying a CLI run proves the wrong thing: the
// CLI negotiates utf8mb4_0900_ai_ci while the connector pool is built with no charset
// (packages/bootstrap/src/connector-db.ts) and reports collation_connection utf8mb4_unicode_ci, and
// error 1267 struck only on the pool. A harness that shells out to `mysql` would have gone green
// while every real report failed.
//
// Preconditions:
//   docker compose --profile mysql up -d
//
// Run: pnpm mysql:reports:accept
//
// Env overrides: MYSQL_HOST (localhost) MYSQL_PORT (13306) MYSQL_USER (root)
//   MYSQL_PASSWORD (Openldr_Local_2026!)
import { sql } from 'kysely';
import { createMysqlStore } from '@openldr/adapter-mysql-store';
import { createConnectorDb } from '@openldr/bootstrap';
import { createMigrator, externalMigrations } from '@openldr/db';
import { SEED_QUERIES } from '../packages/reporting/src/seed/report-seeds';

const HOST = process.env.MYSQL_HOST ?? 'localhost';
const PORT = Number(process.env.MYSQL_PORT ?? 13306);
const USER = process.env.MYSQL_USER ?? 'root';
const PASSWORD = process.env.MYSQL_PASSWORD ?? 'Openldr_Local_2026!';
const DB = `openldr_rpt_${Date.now()}`;

// July 2013 starts on a Monday: working days d01 = Mon 1, d02 = Tue 2, d03 = Wed 3, d04 = Thu 4,
// d05 = Fri 5, d06 = Mon 8. The same calendar the MSSQL check uses, so the two dialects are being
// asked the identical question.
const MONTH = '2013-07';
const PANELS = 'HIVPC';

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
let failures = 0;
function check(cond: boolean, m: string): void {
  if (cond) { ok(m); return; }
  failures += 1;
  console.log(`  ✗ ${m}`);
}

function textOf(id: string): string {
  const values: Record<string, string> = { month: MONTH, panels: PANELS };
  const raw = SEED_QUERIES.find((q) => q.id === id)!.sql.mysql;
  // Mirrors `substituteParams` (packages/dashboards/src/custom-query-run.ts): a global regex
  // inlining an escaped quoted literal, never a bound placeholder.
  return raw.replace(/\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g,
    (_m, k: string) => `'${(values[k] ?? '').replace(/'/g, "''")}'`);
}

/** Day columns carrying a mark, e.g. ['d01']. */
const marks = (row: Record<string, unknown>): string[] =>
  Object.keys(row).filter((k) => /^d\d\d$/.test(k)).sort().filter((k) => String(row[k] ?? '') === '1');

const body = (rows: Record<string, unknown>[]) =>
  rows.filter((r) => r.lab !== '(dates)' && r.lab !== '(week)');

async function main(): Promise<void> {
  const admin = createMysqlStore({ host: HOST, port: PORT, database: 'mysql', user: USER, password: PASSWORD, ssl: false });
  await sql.raw(`create database \`${DB}\``).execute(admin.db);
  await admin.close();

  const store = createMysqlStore({ host: HOST, port: PORT, database: DB, user: USER, password: PASSWORD, ssl: false });
  try {
    step('1. external migrations apply');
    const up = await createMigrator(store.db, externalMigrations('mysql')).migrateToLatest();
    if (up.error) throw up.error;
    ok(`${up.results?.length ?? 0} migrations`);

    step('2. seed one request per rung of the clinical-date ladder');
    const req = async (id: string, batch: string, panel: string | null, authored: string | null) =>
      sql.raw(`insert into lab_requests (id, request_id, panel_code, batch_id, authored_at) values (
        '${id}','${id}',${panel === null ? 'null' : `'${panel}'`},'${batch}',${authored === null ? 'null' : `'${authored}'`})`).execute(store.db);
    const rep = async (id: string, batch: string, lab: string, basedOn: string | null, issued: string | null) =>
      sql.raw(`insert into diagnostic_reports (id, batch_id, performer, performer_display, based_on_id, issued) values (
        '${id}','${batch}','CODE-${lab}','${lab}',${basedOn === null ? 'null' : `'${basedOn}'`},${issued === null ? 'null' : `'${issued}'`})`).execute(store.db);
    const res = async (id: string, reqId: string, ts: string) =>
      sql.raw(`insert into lab_results (id, request_id, result_timestamp) values ('${id}','${reqId}','${ts}')`).execute(store.db);

    // On the panel list, one per rung: registered, resulted, authorised.
    await req('r-auth', 'b1', 'HIVPC', '2013-07-01T08:00:00+03:00'); await rep('d1', 'b1', 'Lab A', 'r-auth', null);
    await req('r-res', 'b2', 'HIVPC', '2013-05-20T08:00:00+03:00'); await rep('d2', 'b2', 'Lab B', 'r-res', null);
    await res('o1', 'r-res', '2013-07-03T09:00:00+03:00');
    await req('r-iss', 'b3', 'HIVPC', '2013-05-21T08:00:00+03:00'); await rep('d3', 'b3', 'Lab C', 'r-iss', '2013-07-05T09:00:00+03:00');
    // Off the list, so it belongs to the collapsed Others row: Mon 8 Jul = d06.
    await req('r-out', 'b4', 'CHEM', '2013-07-08T08:00:00+03:00'); await rep('d4', 'b4', 'Lab D', 'r-out', null);
    ok('4 requests, 4 reports, 1 result');

    step('3. seeded mysql query variants, through the CONNECTOR POOL a report gets');
    const conn = createConnectorDb('mysql', {
      host: HOST, port: String(PORT), database: DB, user: USER, password: PASSWORD,
    });
    try {
      const run = async (id: string) => (await conn.query(textOf(id))).rows;

      const hv = await run('q-transmission-hvleid');
      const hvBody = body(hv);
      check(hvBody.length === 3, `HVL/EID grid: 3 laboratories (got ${hvBody.length})`);
      for (const [lab, day] of [['Lab A', 'd01'], ['Lab B', 'd03'], ['Lab C', 'd05']] as const) {
        const row = hvBody.find((r) => r.lab === lab);
        check(!!row && marks(row).join() === day, `${lab} marks ${day} and only ${day} (got ${row ? marks(row).join() || 'none' : 'no row'})`);
      }
      check(!hvBody.some((r) => r.lab === 'Lab D'), 'the off-list laboratory stays out of the HVL/EID grid');

      const ot = body(await run('q-transmission-other'));
      check(ot.length === 1 && ot[0].lab === 'Others', `Other grid collapses to one Others row (got ${ot.length})`);
      check(ot.length === 1 && marks(ot[0]).join() === 'd06', `Others marks d06 (got ${ot.length === 1 ? marks(ot[0]).join() || 'none' : 'n/a'})`);

      const cal = await run('q-transmission-calendar');
      const header = [cal[0]?.c1, cal[0]?.c2, cal[0]?.c3, cal[0]?.c4, cal[0]?.c5].join('');
      check(header === 'MTWTF', `calendar header is Mon-Fri (got ${header})`);
      check(cal[0]?.c6 === undefined, 'calendar carries no weekend column');
      const cells = cal.slice(1).flatMap((r) => ['c1', 'c2', 'c3', 'c4', 'c5']
        .map((k) => String(r[k] ?? '')).filter((v) => v !== '').map(Number));
      check(cells.reduce((a, b) => a + b, 0) === 4, `calendar totals the 4 arrivals (got ${cells.reduce((a, b) => a + b, 0)})`);

      const sum = (await run('q-transmission-summary'))[0];
      check(String(sum?.labs) === '4', `summary counts 4 laboratories (got ${String(sum?.labs)})`);
      check(Number(sum?.busiest) === Math.max(...cells), `busiest agrees with the calendar's darkest cell (${String(sum?.busiest)} vs ${Math.max(...cells)})`);

      step('4. every OTHER seeded mysql variant at least parses and runs');
      // Not asserted for content: this step exists so a syntax error in any seeded mysql string
      // fails here rather than on an operator's first click.
      for (const q of SEED_QUERIES) {
        if (!q.sql.mysql) continue;
        const params = (q.params ?? []) as { id: string; type?: string }[];
        if (params.some((prm) => prm.type === 'daterange' || !['month', 'panels'].includes(prm.id))) continue;
        try {
          await conn.query(textOf(q.id));
          ok(`${q.id} ran`);
        } catch (e) {
          failures += 1;
          console.log(`  ✗ ${q.id}: ${(e as Error).message}`);
        }
      }
    } finally {
      await conn.close();
    }
  } finally {
    await store.close();
    const cleanup = createMysqlStore({ host: HOST, port: PORT, database: 'mysql', user: USER, password: PASSWORD, ssl: false });
    await sql.raw(`drop database if exists \`${DB}\``).execute(cleanup.db);
    await cleanup.close();
    console.log(`\ndropped ${DB}`);
  }

  if (failures > 0) {
    console.log(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nall checks passed');
}

void main();
