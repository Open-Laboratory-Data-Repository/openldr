import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * `@openldr/db` finds its bundled terminology files at `<bundle folder>/../fixtures/fhir`
 * (packages/db/src/bundled-terminology.ts). The bundle is in `dist/`, so they go to
 * `apps/standalone/fixtures/fhir`. Same source as the server image (apps/server/Dockerfile).
 */
function copyTerminologyFiles(): void {
  const from = join(here, '..', '..', 'packages', 'db', 'fixtures', 'fhir');
  const to = join(here, 'fixtures', 'fhir');
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name.endsWith('.gz')) copyFileSync(join(from, name), join(to, name));
  }
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  noExternal: [/^@openldr\//],
  // Kept external, so Node finds them in node_modules at run time:
  //  - ssh2, cpu-features, pdfkit, quickjs-emscripten: the same four as apps/server/tsup.config.ts,
  //    for the same reasons (native addons, font files and a wasm file found on disk).
  //  - embedded-postgres and its platform packages: postgres.ts resolves the Postgres binaries
  //    from embedded-postgres's own folder in node_modules.
  //  - pg: a direct dependency, so tsup keeps it external anyway. Its optional native part is
  //    loaded with a require() inside a try block, which works unchanged from node_modules.
  external: [
    'ssh2',
    'cpu-features',
    'pdfkit',
    'quickjs-emscripten',
    'embedded-postgres',
    /^@embedded-postgres\//,
    'pg',
  ],
  // Same reasons as apps/server/tsup.config.ts: keep "node:sqlite" intact, and give bundled CJS
  // code a real `require`.
  removeNodeProtocol: false,
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __openldrCreateRequire } from 'module';",
      'const require = __openldrCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  onSuccess: async () => {
    copyTerminologyFiles();
  },
});
