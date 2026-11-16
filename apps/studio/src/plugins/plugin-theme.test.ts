import { describe, it, expect, afterEach } from 'vitest';
import { hostThemeTokens, themeStyleTag, THEME_TOKEN_NAMES } from './plugin-theme';

// jsdom does not cascade tokens.css the way a browser does, so these tests set the studio's
// variables as inline styles on <html>. That is the same root the browser reads.
const STUDIO_VARS: Record<string, string> = {
  '--bg': 'rgb(1, 1, 1)',
  '--card': 'rgb(2, 2, 2)',
  '--table-head': 'rgb(3, 3, 3)',
  '--text': 'rgb(4, 4, 4)',
  '--text-muted': 'rgb(5, 5, 5)',
  '--border': 'rgb(6, 6, 6)',
  '--brand': 'rgb(7, 7, 7)',
  '--primary-foreground': 'rgb(8, 8, 8)',
  '--brand-wash': 'rgba(9, 9, 9, 0.15)',
  '--danger': 'rgb(10, 10, 10)',
  '--success': 'rgb(11, 11, 11)',
  '--warning': 'rgb(12, 12, 12)',
  '--radius': '6px',
  '--font': "'Inter', sans-serif",
  '--mono': "'JetBrains Mono', monospace",
};

function setRoot(vars: Record<string, string>): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

afterEach(() => {
  document.documentElement.removeAttribute('style');
});

describe('hostThemeTokens', () => {
  it('returns the fifteen contract names from a root with the studio variables set', () => {
    setRoot(STUDIO_VARS);
    const t = hostThemeTokens();
    expect(Object.keys(t).sort()).toEqual([...THEME_TOKEN_NAMES].sort());
    expect(THEME_TOKEN_NAMES).toHaveLength(15);
    expect(t['--openldr-bg']).toBe('rgb(1, 1, 1)');
    expect(t['--openldr-surface']).toBe('rgb(2, 2, 2)');
    expect(t['--openldr-surface-2']).toBe('rgb(3, 3, 3)');
    expect(t['--openldr-text']).toBe('rgb(4, 4, 4)');
    expect(t['--openldr-text-muted']).toBe('rgb(5, 5, 5)');
    expect(t['--openldr-border']).toBe('rgb(6, 6, 6)');
    expect(t['--openldr-primary']).toBe('rgb(7, 7, 7)');
    expect(t['--openldr-primary-text']).toBe('rgb(8, 8, 8)');
    expect(t['--openldr-primary-soft']).toBe('rgba(9, 9, 9, 0.15)');
    expect(t['--openldr-danger']).toBe('rgb(10, 10, 10)');
    expect(t['--openldr-success']).toBe('rgb(11, 11, 11)');
    expect(t['--openldr-warning']).toBe('rgb(12, 12, 12)');
    expect(t['--openldr-radius']).toBe('6px');
    expect(t['--openldr-font']).toBe("'Inter', sans-serif");
    expect(t['--openldr-mono']).toBe("'JetBrains Mono', monospace");
  });

  it('resolves a value that is a var() reference to the colour it points at', () => {
    setRoot({ ...STUDIO_VARS, '--card': 'var(--bg)', '--brand': 'var(--nope, var(--text))' });
    const t = hostThemeTokens();
    expect(t['--openldr-surface']).toBe('rgb(1, 1, 1)');
    expect(t['--openldr-primary']).toBe('rgb(4, 4, 4)');
    expect(Object.values(t).some((v) => v.includes('var('))).toBe(false);
  });

  it('leaves out an empty variable, so the page fallback applies', () => {
    const { ['--card']: _drop, ...rest } = STUDIO_VARS;
    setRoot(rest);
    const t = hostThemeTokens();
    expect(t).not.toHaveProperty('--openldr-surface');
    expect(Object.keys(t)).toHaveLength(14);
  });

  it('leaves out a var() reference that points at nothing', () => {
    setRoot({ ...STUDIO_VARS, '--card': 'var(--missing)' });
    expect(hostThemeTokens()).not.toHaveProperty('--openldr-surface');
  });

  it('leaves out a value with a forbidden character', () => {
    setRoot({ ...STUDIO_VARS, '--font': "x} body{display:none", '--radius': '6px;color:red', '--mono': 'a<b' });
    const t = hostThemeTokens();
    expect(t).not.toHaveProperty('--openldr-font');
    expect(t).not.toHaveProperty('--openldr-radius');
    expect(t).not.toHaveProperty('--openldr-mono');
    expect(t['--openldr-bg']).toBe('rgb(1, 1, 1)');
  });
});

describe('themeStyleTag', () => {
  it('sets each token on the root and wraps every selector of the default styles in :where()', () => {
    const tag = themeStyleTag({ '--openldr-bg': 'rgb(1, 1, 1)', '--openldr-text': 'rgb(4, 4, 4)' });
    expect(tag.startsWith('<style')).toBe(true);
    expect(tag.endsWith('</style>')).toBe(true);
    const css = tag.replace(/^<style[^>]*>/, '').replace(/<\/style>$/, '');
    expect(css).toContain('--openldr-bg:rgb(1, 1, 1)');
    expect(css).toContain('--openldr-text:rgb(4, 4, 4)');
    const rules = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim());
    expect(rules.length).toBeGreaterThan(5);
    // Each selector is one :where() and nothing outside it, so its specificity is zero.
    for (const sel of rules) {
      expect(sel.startsWith(':where(')).toBe(true);
      expect(sel.endsWith(')')).toBe(true);
      expect(sel.indexOf(':where(', 1)).toBe(-1);
    }
    // The defaults cover the elements the brief names.
    const inner = rules.flatMap((s) => s.slice(':where('.length, -1).split(',').map((x) => x.trim()));
    for (const el of [':root', 'body', 'a', 'button', 'input', 'select', 'textarea', 'table', 'th', 'td', 'hr', ':focus-visible']) {
      expect(inner).toContain(el);
    }
  });

  it('drops a token whose name or value is not safe in a style element', () => {
    const tag = themeStyleTag({
      '--openldr-bg': 'rgb(1, 1, 1)',
      '--openldr-text': 'red}</style><script>alert(1)</script>',
      '--evil': 'red',
      '--openldr-x;y': 'red',
    });
    expect(tag).toContain('--openldr-bg:rgb(1, 1, 1)');
    expect(tag).not.toContain('<script');
    expect(tag).not.toContain('--evil');
    expect(tag).not.toContain('--openldr-x;y');
    expect(tag.match(/<\/style>/g)).toHaveLength(1);
  });
});
