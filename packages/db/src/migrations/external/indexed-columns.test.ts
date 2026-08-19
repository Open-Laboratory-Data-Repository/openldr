import { describe, it, expect } from 'vitest';
import { externalMigrations } from './index';
import { collectCompiledSql } from './compile-test-helpers';

// 011_terminology_codes.ts wrote the rule down in prose (011:23-28): a column that a createIndex
// call names must be a bounded type (keyType or shortKeyType), never textType. MySQL cannot index
// `longtext` (error 1170) and MSSQL cannot index `nvarchar(max)` (Msg 1919). The rule held only
// because every author remembered to re-read that comment; 017 did not, and shipped an index on a
// textType column. A comment cannot enforce itself, so this compiles every external migration's
// real DDL for MySQL and MSSQL and checks it directly, rather than re-stating the rule as another
// comment one migration away from being lost again.
//
// This runs the ACTUAL migration functions through Kysely's real MySQL/MSSQL query compilers (see
// compile-test-helpers.ts), then reads the compiled SQL text to track each (table, column)'s
// current type and flag any column a `create index` statement names while that type is a LOB
// (`longtext` on MySQL, `nvarchar(max)` on MSSQL). It does not parse TypeScript source: the
// compiled SQL is a small, uniform grammar Kysely itself generates, so it is far less fragile than
// guessing at each migration file's local variable names.
const IDENT = '["`]';
const TYPE_TOKEN = '[a-zA-Z][a-zA-Z0-9]*(?:\\([a-zA-Z0-9]+\\))?';
const LOB_TYPE = /^(n?var)?(long)?text$|max\)$/i;

function parenBody(stmt: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < stmt.length; i++) {
    if (stmt[i] === '(') depth++;
    else if (stmt[i] === ')') {
      depth--;
      if (depth === 0) return stmt.slice(openIndex + 1, i);
    }
  }
  throw new Error(`unbalanced parens in compiled SQL: ${stmt}`);
}

/** For each `create index ... on table (cols)` statement, the type each named column carried at
 *  that point in the migration sequence. A LOB type here is the exact condition that makes the
 *  index illegal on MySQL/MSSQL. */
function indexedColumnTypes(compiledSql: string[]): { table: string; column: string; type: string | undefined }[] {
  const types = new Map<string, Map<string, string>>();
  const columnsOf = (table: string) => types.get(table) ?? types.set(table, new Map()).get(table)!;
  const found: { table: string; column: string; type: string | undefined }[] = [];

  for (const stmt of compiledSql) {
    let m: RegExpMatchArray | null;
    if ((m = stmt.match(new RegExp(`^create table ${IDENT}(\\w+)${IDENT}\\s*\\(`)))) {
      const table = m[1];
      const openIndex = stmt.indexOf('(', m.index! + m[0].length - 1);
      // Strip a named table-level PRIMARY KEY constraint clause (016_ingest_events.ts): it is not
      // a column declaration, and its own `primary key (...)` would otherwise be misread as one.
      const body = parenBody(stmt, openIndex).replace(new RegExp(`constraint ${IDENT}\\w+${IDENT}\\s+primary key\\s*\\([^)]*\\)`, 'g'), '');
      for (const cm of body.matchAll(new RegExp(`${IDENT}(\\w+)${IDENT}\\s+(${TYPE_TOKEN})`, 'g'))) {
        columnsOf(table).set(cm[1], cm[2]);
      }
    } else if ((m = stmt.match(new RegExp(`^alter table ${IDENT}(\\w+)${IDENT}\\s+rename to ${IDENT}(\\w+)${IDENT}`)))) {
      types.set(m[2], new Map(types.get(m[1]) ?? []));
    } else if ((m = stmt.match(/^EXEC sp_rename '(\w+)', '(\w+)'/))) {
      // MSSQL has no ALTER TABLE ... RENAME TO; 007_drop_thin_rename_v2.ts uses sp_rename instead.
      types.set(m[2], new Map(types.get(m[1]) ?? []));
    } else if (
      (m = stmt.match(
        new RegExp(`^alter table ${IDENT}(\\w+)${IDENT}\\s+(?:add(?:\\s+column)?|modify column|alter column)\\s+${IDENT}(\\w+)${IDENT}\\s+(?:type\\s+)?(${TYPE_TOKEN})`),
      ))
    ) {
      columnsOf(m[1]).set(m[2], m[3]);
    } else if ((m = stmt.match(new RegExp(`^create index ${IDENT}\\w+${IDENT} on ${IDENT}(\\w+)${IDENT}\\s*\\(`)))) {
      const table = m[1];
      const openIndex = stmt.indexOf('(', m.index! + m[0].length - 1);
      const body = parenBody(stmt, openIndex);
      for (const cm of body.matchAll(new RegExp(`${IDENT}(\\w+)${IDENT}`, 'g'))) {
        found.push({ table, column: cm[1], type: columnsOf(table).get(cm[1]) });
      }
    }
  }
  return found;
}

describe('every indexed column across the external migrations is a bounded type', () => {
  it.each(['mysql', 'mssql'] as const)('%s: no create index names a LOB (textType) column', async (engine) => {
    const compiledSql = await collectCompiledSql(engine, async (db) => {
      for (const migration of Object.values(externalMigrations(engine))) {
        await migration.up(db);
      }
    });

    const indexed = indexedColumnTypes(compiledSql);
    expect(indexed.length).toBeGreaterThan(0); // sanity: the parser actually found the indexes

    const lob = indexed.filter((c) => !c.type || LOB_TYPE.test(c.type));
    expect(lob).toEqual([]);
  });
});
