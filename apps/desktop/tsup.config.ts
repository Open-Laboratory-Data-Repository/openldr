import { defineConfig } from 'tsup';

// Two builds into one dist folder. Only the first cleans it: two builds that both clean would
// delete each other's output.
export default defineConfig([
  {
    // The main process, as an ES module.
    entry: { main: 'src/main.ts' },
    format: ['esm'],
    target: 'node22',
    clean: true,
    external: ['electron'],
  },
  {
    // The preload. A sandboxed preload cannot be an ES module, so it is CommonJS.
    entry: { preload: 'src/preload.ts' },
    format: ['cjs'],
    target: 'node22',
    clean: false,
    external: ['electron'],
    outExtension: () => ({ js: '.cjs' }),
  },
]);
