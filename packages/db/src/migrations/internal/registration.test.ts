import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { internalMigrations } from './index';

/**
 * Every migration file must be registered in `internalMigrations`, and every registered name must
 * have a file.
 *
 * ⛔ This exists because migration 089 shipped to main UNREGISTERED and nothing caught it. Its own
 * test file passed, because those tests import `up`/`down` and call them directly. `pnpm openldr
 * db reset` passed too, because on a fresh install there is no Facility row to repoint, so a dead
 * migration and a correctly no-opping one produce identical output. Two code reviews read the
 * migration closely and neither looked at the map.
 *
 * A numbering GAP blocks boot, so that failure mode is loud. A migration that is simply absent
 * from the map is silent: the sequence still runs 001 to 088 with no complaint, and the missing
 * one is never applied on any install, ever.
 */
describe('every internal migration is registered', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  const files = readdirSync(here)
    .filter((f) => /^\d{3}_[a-z0-9_]+\.ts$/.test(f))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();

  const registered = Object.keys(internalMigrations).sort();

  it('finds migration files to check, so this test cannot pass vacuously', () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it('registers every migration file', () => {
    const missing = files.filter((f) => !registered.includes(f));
    expect(missing, `migration files present but NOT in internalMigrations: ${missing.join(', ')}`).toEqual([]);
  });

  it('has a file for every registered migration', () => {
    const orphaned = registered.filter((r) => !files.includes(r));
    expect(orphaned, `registered but no file: ${orphaned.join(', ')}`).toEqual([]);
  });

  it('registers them in unbroken numeric order, because a gap blocks boot', () => {
    const numbers = registered.map((n) => Number(n.slice(0, 3)));
    const expected = Array.from({ length: numbers.length }, (_, i) => i + 1);
    expect(numbers).toEqual(expected);
  });
});
