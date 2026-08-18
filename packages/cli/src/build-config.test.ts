import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Module scope, not inside the test — `it.skipIf` is evaluated at collection time.
const BUNDLE = join(PKG_ROOT, 'dist', 'index.js');

/** The four packages the SERVER externalises. Each resolves a data file or a native addon from
 *  disk at runtime, so bundling it breaks that lookup in the built image only. The CLI reaches
 *  all four through @openldr/bootstrap, so it needs the identical treatment.
 *  Source of truth: apps/server/tsup.config.ts. */
const MUST_BE_EXTERNAL = ['ssh2', 'cpu-features', 'pdfkit', 'quickjs-emscripten'];

describe('cli build config', () => {
  it('externalises every package the server externalises', async () => {
    const mod = await import('../tsup.config');
    const cfg = mod.default as { external?: string[] };
    for (const dep of MUST_BE_EXTERNAL) {
      expect(cfg.external ?? []).toContain(dep);
    }
  });

  it('declares each externalised package as a direct dependency', () => {
    // An external that is NOT a direct dependency is worse than bundling it: pnpm deploy
    // resolves only declared deps, so the import survives the bundle and then fails to
    // resolve at runtime with ERR_MODULE_NOT_FOUND.
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    for (const dep of MUST_BE_EXTERNAL) {
      expect(pkg.dependencies[dep], `${dep} missing from packages/cli dependencies`).toBeTruthy();
    }
  });

  // `skipIf`, not an early `return`. The plain test gate runs without a prior build, so an
  // early return would report GREEN having checked nothing — a test that silently asserts
  // nothing in its most common execution. Skipped is the honest signal.
  it.skipIf(!existsSync(BUNDLE))('does not inline pdfkit into the bundle', () => {
    // `AFMFont` is a pdfkit-internal identifier that appears nowhere else. Present in the
    // bundle ⇒ pdfkit was inlined ⇒ its .afm font metric files will not travel and every
    // PDF-producing command dies in the image.
    expect(readFileSync(BUNDLE, 'utf8')).not.toContain('AFMFont');
  });
});
