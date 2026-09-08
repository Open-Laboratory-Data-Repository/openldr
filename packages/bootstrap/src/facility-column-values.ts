import type { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { parse as parseCsvStream } from 'csv-parse';

export interface ColumnValues {
  /** Distinct, non-empty, in first-seen order, capped at `limit`. */
  values: string[];
  /** How many distinct values the whole file holds, counted past the cap. */
  distinct: number;
  truncated: boolean;
}

export interface ReadColumnValuesOptions {
  format: 'csv' | 'jsonl';
  /** The source column's own header text, as it appears in the file. */
  header: string;
  limit: number;
}

const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/** One column's vocabulary, for checking a single mapping without validating the register.
 *
 *  ⛔ THE WHOLE POINT IS THAT IT READS ONE COLUMN. Checking `Type` against its value set must not
 *  cost a parse of 3788 rows times 21 columns, which is what running the full validate would do and
 *  what the operator rejected. This still streams the file, so it is constant memory, but it returns
 *  a vocabulary rather than a table.
 *
 *  ⛔ THE SET IS CAPPED AND THE COUNT IS NOT. A column with 3000 distinct values is a column that was
 *  mapped wrongly, and the operator needs to be told that, not handed 3000 pick-lists. `distinct`
 *  reports the truth while `values` stays a list a person can work through. */
export async function readColumnValues(
  stream: Readable,
  { format, header, limit }: ReadColumnValuesOptions,
): Promise<ColumnValues> {
  const seen = new Set<string>();
  const values: string[] = [];

  const record = (cell: string | undefined) => {
    if (cell === undefined) return;
    const v = cell.trim();
    if (v === '') return;
    if (!seen.has(v)) {
      seen.add(v);
      if (values.length < limit) values.push(v);
    }
  };

  if (format === 'csv') {
    // Same parser and options as `readFileRows`'s `readCsvRows`: a real CSV parse, streamed, with
    // `relax_column_count`/`relax_quotes` so one ragged row does not kill the whole read. A header
    // the file does not have never throws here, it just finds nothing in every row.
    const parser = stream.pipe(parseCsvStream({
      columns: false,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
    }));

    let headers: string[] = [];
    let headerIndex = -1;
    let first = true;

    for await (const row of parser as AsyncIterable<string[]>) {
      if (first) {
        headers = row.map((h, i) => (i === 0 ? stripBom(h) : h));
        headerIndex = headers.indexOf(header);
        first = false;
        continue;
      }
      if (headerIndex === -1) continue;
      record(row[headerIndex]);
    }
  } else {
    // Same line-by-line JSONL read as `readFileRows`: a line that is not JSON, or that is not an
    // object, is skipped rather than thrown on. This module does not need the skip count itself,
    // only the one column's values, so a bad line just contributes nothing.
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let first = true;

    for await (const raw of rl) {
      const line = first ? stripBom(raw) : raw;
      first = false;
      if (line.trim() === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
      const obj = parsed as Record<string, unknown>;
      const cell = obj[header];
      record(cell === undefined || cell === null ? undefined : String(cell));
    }
    rl.close();
  }

  return { values, distinct: seen.size, truncated: seen.size > values.length };
}
