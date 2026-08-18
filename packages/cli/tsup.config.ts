import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  noExternal: [/^@openldr\//],
  // Deps that must stay external — bundling them breaks runtime file resolution. The CLI
  // reaches all four through @openldr/bootstrap and needs the same treatment the server
  // already has (apps/server/tsup.config.ts), for the same reasons:
  //  - ssh2 / cpu-features: native `.node` addons (SFTP).
  //  - pdfkit: loads its standard-font `.afm` metric files from disk at runtime.
  //  - quickjs-emscripten: resolves `emscripten-module.wasm` relative to its own module URL.
  // Bundled, each fails ONLY in the built image — from a source checkout `pnpm openldr` runs
  // the TypeScript source through tsx and never touches dist/, so nothing here is exercised
  // by the dev path or by `build:check`'s `--help`.
  external: ['ssh2', 'cpu-features', 'pdfkit', 'quickjs-emscripten'],
  // tsup defaults removeNodeProtocol:true, which strips the "node:" prefix from
  // all node: imports. node:sqlite (Node 22+) has no bare "sqlite" fallback, so
  // the stripped import fails at runtime. Disable the stripping so "node:sqlite"
  // stays intact in the bundle output.
  removeNodeProtocol: false,
  // The shebang must stay on line 1. The createRequire shim defines a real
  // `require` in module scope so esbuild's `__require` polyfill delegates to
  // it instead of throwing "Dynamic require of X is not supported" — needed
  // because bundled CJS deps (e.g. dotenv) call require('fs') at runtime.
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __openldrCreateRequire } from 'module';",
      'const require = __openldrCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});
