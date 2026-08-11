/** JSON with object keys recursively sorted (arrays keep order), so equality is key-order-insensitive.
 *  Postgres re-sorts jsonb keys on read, so a plain JSON.stringify would report spurious diffs.
 *
 *  ⛔ Browser-safe — re-exported via `./pure`. Do NOT import `node:*` here; the `createHash`-based
 *  `canonicalHash` lives in `./canonical-hash.ts` for exactly that reason. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.keys(val as Record<string, unknown>).sort().reduce<Record<string, unknown>>(
          (o, k) => { o[k] = (val as Record<string, unknown>)[k]; return o; }, {})
      : val);
}
