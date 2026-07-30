import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  noExternal: [/^@openldr\//],
  // Deps that must stay external — bundling them breaks runtime file resolution:
  //  - ssh2 / cpu-features: native `.node` addons (via @openldr/bootstrap → SFTP node).
  //  - pdfkit: loads its standard-font `.afm` metric files from disk at runtime (via
  //    @openldr/report-pdf); bundled, those data files don't travel and every report PDF 500s.
  //  - quickjs-emscripten: resolves its `emscripten-module.wasm` relative to its own module
  //    URL (via @openldr/workflows → the SEC-01 JS isolate). Bundled, that URL becomes the
  //    server bundle's own dir, so it looks for `<dist>/emscripten-module.wasm`, which does
  //    not exist — every Switch/JS node then dies with
  //    "ENOENT ... open '/app/dist/emscripten-module.wasm'". That kills the Switch node in
  //    `wf-ingest`, i.e. ALL webhook ingestion, but only in the built image: from a source
  //    checkout the package resolves normally, so dev runs and the test suite stay green.
  // They aren't in this package's own dependencies, so we also declare them as direct deps
  // (package.json) → pnpm deploy installs them intact in node_modules for the runtime require.
  external: ['ssh2', 'cpu-features', 'pdfkit', 'quickjs-emscripten'],
  // tsup defaults removeNodeProtocol:true, which strips the "node:" prefix.
  // node:sqlite (Node 22+) has no bare "sqlite" fallback, so the stripped
  // import fails at runtime. Keep "node:sqlite" intact in the bundle output.
  removeNodeProtocol: false,
  // The createRequire shim defines a real `require` in module scope so
  // esbuild's `__require` polyfill delegates to it instead of throwing
  // "Dynamic require of X is not supported" — needed because bundled CJS
  // deps (e.g. dotenv) call require('fs') at runtime under ESM output.
  banner: {
    js: [
      "import { createRequire as __openldrCreateRequire } from 'module';",
      'const require = __openldrCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});
