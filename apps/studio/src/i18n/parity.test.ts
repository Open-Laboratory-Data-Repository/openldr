import { describe, it, expect } from 'vitest';
import { en } from './en';
import { fr } from './fr';
import { pt } from './pt';
import { CAPABILITIES, CAPABILITY_KEYS } from '@openldr/rbac';

/** Recursively collect dotted key paths from a nested resource object. */
function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' && !Array.isArray(v) ? keyPaths(v as Record<string, unknown>, path) : [path];
  });
}

const enKeys = keyPaths(en).sort();

describe('i18n key parity', () => {
  it('en has a non-trivial key set', () => {
    expect(enKeys.length).toBeGreaterThan(100);
  });
  it('fr matches en exactly', () => {
    expect(keyPaths(fr as Record<string, unknown>).sort()).toEqual(enKeys);
  });
  it('pt matches en exactly', () => {
    expect(keyPaths(pt as Record<string, unknown>).sort()).toEqual(enKeys);
  });
});

// A capability key such as 'users.manage' is read as the path roles.capability.users.manage.
describe('capability labels', () => {
  const at = (res: Record<string, unknown>, path: string): unknown =>
    path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), res);

  it('every catalog key has a label and a description in en, fr and pt', () => {
    const missing: string[] = [];
    for (const [lang, res] of [['en', en], ['fr', fr], ['pt', pt]] as const) {
      for (const key of CAPABILITY_KEYS) {
        for (const part of ['label', 'description']) {
          const v = at(res as Record<string, unknown>, `roles.capability.${key}.${part}`);
          if (typeof v !== 'string' || v.trim() === '') missing.push(`${lang} ${key}.${part}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('holds no label for a key the catalog does not have', () => {
    const extra = keyPaths((en.roles as { capability: Record<string, unknown> }).capability)
      .map((p) => p.replace(/\.(label|description)$/, ''))
      .filter((k) => !CAPABILITY_KEYS.includes(k));
    expect([...new Set(extra)]).toEqual([]);
  });

  it('the English label and description are the catalog ones', () => {
    const res = en as Record<string, unknown>;
    const bad = CAPABILITIES.filter((c) =>
      at(res, `roles.capability.${c.key}.label`) !== c.label || at(res, `roles.capability.${c.key}.description`) !== c.description,
    ).map((c) => c.key);
    expect(bad).toEqual([]);
  });
});
