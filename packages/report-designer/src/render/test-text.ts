import zlib from 'node:zlib';

/** The drawn text of a PDF, for tests.
 *
 *  Two steps, both required: inflate every flate stream, then rejoin the hex chunks WITHIN one
 *  `TJ` array. pdfkit splits a string on kerning pairs, so searching the raw bytes for a whole
 *  word silently fails on any word that happens to contain one. */
export function pdfTextOf(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  let content = '';
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { content += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { /* a font, not a content stream */ }
  }
  return [...content.matchAll(/\[(.*?)\]\s*TJ/g)]
    .map((m) => [...m[1].matchAll(/<([0-9a-fA-F]*)>/g)]
      .map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''))
    .join('\n');
}
