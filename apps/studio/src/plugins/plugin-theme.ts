/** The studio's theme, handed to a plugin page.
 *
 * A plugin page sits in a sandboxed frame and sees none of the studio's CSS. So the host reads
 * its own theme here and sends it as fifteen `--openldr-*` variables (the names are a contract
 * with plugin authors). The page reads them with its own value as the fallback.
 *
 * Values are read from the computed style of <html>, not copied from tokens.css, so a branded
 * or changed studio theme carries over. A colour is resolved to a plain `rgb(...)` text first,
 * because the frame cannot resolve the studio's own variables. */

/** Contract name to the studio variable that means the same thing (see tokens.css). */
const TOKEN_SOURCES: ReadonlyArray<readonly [string, string, 'color' | 'text']> = [
  ['--openldr-bg', '--bg', 'color'],
  ['--openldr-surface', '--card', 'color'],
  ['--openldr-surface-2', '--table-head', 'color'],
  ['--openldr-text', '--text', 'color'],
  ['--openldr-text-muted', '--text-muted', 'color'],
  ['--openldr-border', '--border', 'color'],
  ['--openldr-primary', '--brand', 'color'],
  ['--openldr-primary-text', '--primary-foreground', 'color'],
  ['--openldr-primary-soft', '--brand-wash', 'color'],
  ['--openldr-danger', '--danger', 'color'],
  ['--openldr-success', '--success', 'color'],
  ['--openldr-warning', '--warning', 'color'],
  ['--openldr-radius', '--radius', 'text'],
  ['--openldr-font', '--font', 'text'],
  ['--openldr-mono', '--mono', 'text'],
];

export const THEME_TOKEN_NAMES: readonly string[] = TOKEN_SOURCES.map(([name]) => name);

const NAME_RE = /^--openldr-[a-z0-9-]{1,40}$/;
const FORBIDDEN_RE = /[<>{};]/;

/** True when a name and value are safe to write into a style element. */
function safeToken(name: string, value: unknown): value is string {
  return NAME_RE.test(name) && typeof value === 'string' && value.length > 0 && value.length <= 200 && !FORBIDDEN_RE.test(value);
}

/** Replace each `var(--x[, fallback])` with the value of `--x` on the root, a few levels deep.
 *  Returns '' when a reference points at nothing and has no fallback. A browser has usually
 *  done this already in the computed value; jsdom has not, and this keeps both the same. */
function expandVars(value: string, cs: CSSStyleDeclaration, depth = 0): string {
  if (depth > 8 || !value.includes('var(')) return value;
  let out = '';
  let i = 0;
  while (i < value.length) {
    const start = value.indexOf('var(', i);
    if (start === -1) { out += value.slice(i); break; }
    out += value.slice(i, start);
    // Find the closing bracket of this var(), allowing brackets inside the fallback.
    let level = 0;
    let end = -1;
    for (let j = start + 3; j < value.length; j++) {
      if (value[j] === '(') level++;
      else if (value[j] === ')') { level--; if (level === 0) { end = j; break; } }
    }
    if (end === -1) return '';
    const inner = value.slice(start + 4, end);
    const comma = inner.indexOf(',');
    const ref = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? '' : inner.slice(comma + 1).trim();
    let resolved = expandVars(cs.getPropertyValue(ref).trim(), cs, depth + 1);
    if (!resolved && fallback) resolved = expandVars(fallback, cs, depth + 1);
    if (!resolved) return '';
    out += resolved;
    i = end + 1;
  }
  return out.trim();
}

/** Turn a colour text into the browser's computed form (`rgb(...)` or `color(...)`), using a
 *  hidden element inside the studio's document. Returns '' when it is not a colour. */
function resolveColor(value: string, probe: HTMLElement): string {
  probe.style.color = '';
  probe.style.color = value;
  if (!probe.style.color) return '';
  const computed = getComputedStyle(probe).color.trim();
  return computed || probe.style.color;
}

/** The studio's theme as it is right now, under the fifteen contract names. A value that is
 *  empty or not safe in a style element is left out, so the page's own fallback applies. */
export function hostThemeTokens(): Record<string, string> {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const out: Record<string, string> = {};
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.display = 'none';
  root.appendChild(probe);
  try {
    for (const [name, source, kind] of TOKEN_SOURCES) {
      const raw = expandVars(cs.getPropertyValue(source).trim(), cs);
      if (!raw) continue;
      const value = kind === 'color' ? resolveColor(raw, probe) : raw;
      if (safeToken(name, value)) out[name] = value;
    }
  } finally {
    probe.remove();
  }
  return out;
}

/** Default styles for bare elements, from the same tokens. They sit in the `openldr-host`
 *  cascade layer. This style element is the first in the frame, so that layer is declared
 *  first and is the lowest: a rule in any of the plugin's own layers (Tailwind puts its
 *  utilities in layers) wins, and an unlayered plugin rule beats every layer. Every selector
 *  is also one `:where()`, which has no weight, as a second guard. */
const DEFAULT_STYLES = [
  ':where(body){background:var(--openldr-bg);color:var(--openldr-text);font-family:var(--openldr-font)}',
  ':where(a){color:var(--openldr-primary)}',
  ':where(button,input,select,textarea){font:inherit;color:var(--openldr-text);background:var(--openldr-surface);border:1px solid var(--openldr-border);border-radius:var(--openldr-radius)}',
  ':where(table){border-collapse:collapse}',
  ':where(th,td){border-bottom:1px solid var(--openldr-border);text-align:left}',
  ':where(th){background:var(--openldr-surface-2);color:var(--openldr-text-muted)}',
  ':where(hr){border:0;border-top:1px solid var(--openldr-border)}',
  ':where(:focus-visible){outline:2px solid var(--openldr-primary);outline-offset:1px}',
].join('');

/** A `<style>` element that sets the tokens on the page's root and gives bare elements their
 *  default styles. A token whose name or value is not safe is left out.
 *
 *  The tokens stay outside the layer. They are custom properties, which no plugin rule sets
 *  by accident, and a page reads them with its own fallback (`var(--openldr-bg, #fff)`), which
 *  still works when one is missing. An unlayered `:root` rule of the page still beats
 *  `:where(:root)` here. Once the SDK starts, it sets the tokens as inline style on the root,
 *  which beats any stylesheet: the host is the source of truth for them. */
export function themeStyleTag(tokens: Record<string, string>): string {
  const decls = Object.entries(tokens)
    .filter(([name, value]) => safeToken(name, value))
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
  return `<style data-openldr-host-theme>:where(:root){${decls}}@layer openldr-host{${DEFAULT_STYLES}}</style>`;
}
