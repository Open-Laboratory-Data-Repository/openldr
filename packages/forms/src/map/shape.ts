/**
 * The shape of one item: its top-level field names and the JSON type of each, never a value.
 * Two items with the same keys and types have the same hash, whatever their values and key order.
 */

export type ShapeFieldType = 'string' | 'number' | 'boolean' | 'list' | 'object' | 'null';

export interface Shape {
  hash: string;
  fields: { name: string; type: ShapeFieldType }[];
}

function typeOf(v: unknown): ShapeFieldType | null {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'list';
  switch (typeof v) {
    case 'string':
      return 'string';
    case 'number':
    case 'bigint':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      // undefined, a function or a symbol: JSON cannot hold it, so the field is absent.
      return null;
  }
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** FNV-1a 64 over the UTF-8 bytes, as 16 hex digits. Small and synchronous; not for security. */
function fnv1a64(text: string): string {
  let h = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= BigInt(byte);
    h = (h * FNV_PRIME) & MASK_64;
  }
  return h.toString(16).padStart(16, '0');
}

export function shapeOf(json: Record<string, unknown>): Shape {
  const fields: Shape['fields'] = [];
  for (const name of Object.keys(json).sort()) {
    const type = typeOf(json[name]);
    if (type) fields.push({ name, type });
  }
  return { hash: fnv1a64(JSON.stringify(fields.map((f) => [f.name, f.type]))), fields };
}
