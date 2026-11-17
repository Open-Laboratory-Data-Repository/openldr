/**
 * JSON for a lab's webhook post, keeping every digit of a long whole number.
 *
 * A JSON number is read as a 64-bit float, which holds whole numbers exactly only up to
 * 9007199254740991. A specimen number like 4471200000000000123 sent without quotes would come back
 * as 4471200000000000000, and three specimens could end up with one number. So before the normal
 * parse, each whole-number token outside the safe range is put in quotes: it arrives as its exact
 * digits, as text. Safe whole numbers, decimals and exponents stay numbers. Strings are never
 * touched. This works on every Node version, with no reviver source access needed.
 *
 * `keptAsText` names the field of each such number (its object key, or the key of the list it is
 * in), once each, so the run can tell the lab to send it in quotes. Never a value.
 */

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
// JSON's number grammar. A leading zero is matched alone, so "00071" still fails the parse.
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
// Whitespace then ':' right after a number: the number is in a key's place.
const KEY_COLON = /\s*:/y;

function keyText(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

/**
 * The JSON text with each long whole number put in quotes, and the fields that held one. A caller
 * with its own JSON reader (the webhook keeps Fastify's, which refuses `__proto__`) parses `text`.
 */
export function quoteLongIntegers(text: string): { text: string; keptAsText: string[] } {
  let out = '';
  let copied = 0;
  const kept: string[] = [];
  // One entry per open object or list: the key its values are under. A list takes its own key.
  const keys: (string | null)[] = [];
  let lastString: string | null = null;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      lastString = text.slice(i + 1, j);
      i = j + 1;
      continue;
    }
    if (c === ':') {
      if (keys.length > 0 && lastString !== null) keys[keys.length - 1] = keyText(lastString);
      i++;
      continue;
    }
    if (c === '{') {
      keys.push(null);
      i++;
      continue;
    }
    if (c === '[') {
      keys.push(keys.length > 0 ? keys[keys.length - 1] : null);
      i++;
      continue;
    }
    if (c === '}' || c === ']') {
      keys.pop();
      i++;
      continue;
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(text);
      if (!m) {
        i++;
        continue;
      }
      const token = m[0];
      const whole = !/[.eE]/.test(token);
      // A number followed by ':' sits where a key belongs. JSON forbids that, so leave it unquoted
      // and let the parse refuse it, as it would without this scan.
      KEY_COLON.lastIndex = i + token.length;
      const asKey = KEY_COLON.test(text);
      if (whole && !asKey) {
        const n = BigInt(token);
        if (n > MAX || n < -MAX) {
          out += `${text.slice(copied, i)}"${token}"`;
          copied = i + token.length;
          const key = keys.length > 0 ? (keys[keys.length - 1] ?? '(value)') : '(value)';
          if (!kept.includes(key)) kept.push(key);
        }
      }
      i += token.length;
      continue;
    }
    i++;
  }
  out += text.slice(copied);
  return { text: out, keptAsText: kept };
}

export function parseJsonKeepingLongIntegers(text: string): { value: unknown; keptAsText: string[] } {
  const quoted = quoteLongIntegers(text);
  return { value: JSON.parse(quoted.text), keptAsText: quoted.keptAsText };
}
