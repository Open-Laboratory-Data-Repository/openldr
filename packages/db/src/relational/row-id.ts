/** Dependency-free, stable hash (browser-safe: no node:crypto). */
export function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${h.toString(16)}-${s.length.toString(16)}`;
}

const MAX_ID_LENGTH = 200;

/** A deterministic row id from its natural key: readable when short, hashed when it would not fit
 *  `keyType` on MySQL/SQL Server. Deterministic because a re-projection must recompute it. */
export function boundedRowId(parts: string[], prefix: string): string {
  const readable = parts.join('|');
  return readable.length <= MAX_ID_LENGTH ? readable : `${prefix}-${djb2Hex(readable)}`;
}
