import type { Readable } from 'node:stream';
import { createInterface } from 'node:readline';

export interface FileRowWindow {
  headers: string[];
  rows: string[][];
  /** Every data row the stream yielded. The stream is always drained, so this is the file's true
   *  row count, which is what the caller needs to paginate. */
  scanned: number;
}

export interface ReadFileRowsOptions {
  format: 'csv' | 'jsonl';
  offset: number;
  limit: number;
}

/** ⛔ NAIVE SPLIT ON ',', deliberately, and the same call `suggest-map` already makes: a quoted
 *  header containing a comma splits wrongly. This is a VIEW of the file, never the authoritative
 *  parse, which stays `parseFacilityCsv`'s. Do not grow a second CSV parser here. */
const splitCsv = (line: string): string[] => line.split(',').map((c) => c.trim());

const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

export async function readFileRows(
  stream: Readable,
  { format, offset, limit }: ReadFileRowsOptions,
): Promise<FileRowWindow> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let headers: string[] = [];
  const rows: string[][] = [];
  let scanned = 0;
  let first = true;

  for await (const raw of rl) {
    const line = first ? stripBom(raw) : raw;
    if (line.trim() === '') { first = false; continue; }
    if (format === 'csv' && first) { headers = splitCsv(line); first = false; continue; }
    first = false;
    if (format === 'jsonl') {
      const obj = JSON.parse(line) as Record<string, unknown>;
      for (const k of Object.keys(obj)) if (!headers.includes(k)) headers.push(k);
      if (scanned >= offset && rows.length < limit) {
        rows.push(headers.map((h) => (obj[h] === undefined || obj[h] === null ? '' : String(obj[h]))));
      }
    } else if (scanned >= offset && rows.length < limit) {
      rows.push(splitCsv(line));
    }
    scanned += 1;
  }
  rl.close();
  return { headers, rows, scanned };
}
