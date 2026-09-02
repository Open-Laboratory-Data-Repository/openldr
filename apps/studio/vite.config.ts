/// <reference types="vitest" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Single source of truth for the docs version: the app's package version. Injected at
// build/test time so DOCS_VERSION tracks releases (see src/docs/version.ts).
const pkgVersion = createRequire(import.meta.url)('./package.json').version as string;

// Dev-only: Vite serves the SPA under base `/studio/` and, for a bare `/studio` (no trailing
// slash), shows a "did you mean /studio/" notice instead of redirecting. Send a 302 so the bare
// path just works in dev (nginx handles this in production).
function redirectStudioBase(): Plugin {
  return {
    name: 'redirect-studio-base',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [path, query] = (req.url ?? '').split('?');
        if (path === '/studio') {
          res.writeHead(302, { Location: '/studio/' + (query ? `?${query}` : '') });
          res.end();
          return;
        }
        next();
      });
    },
  };
}

/**
 * Serves and ships pdfjs's STANDARD FONT DATA under `<base>/standard_fonts/`.
 *
 * A report PDF references Helvetica and Helvetica-Bold and embeds neither: they are two of the
 * 14 standard PDF fonts a viewer is expected to supply. pdfjs supplies them from this directory
 * (LiberationSans, metrically compatible), and WITHOUT it silently substitutes a fallback with
 * the wrong metrics — the letters space out and the page looks broken, which is what every
 * in-app preview did until now. Acrobat and the browser's own PDF viewer were always fine, so
 * the downloaded file never showed it.
 *
 * The WHOLE directory, not the two files Helvetica needs today: pdfjs decides which file it
 * wants from its own font map, so hand-picking would turn a future `Times-Roman` back into the
 * broken fallback with no error. 800K of assets fetched only on demand.
 */
function pdfjsStandardFonts(): Plugin {
  const dir = fileURLToPath(new URL('standard_fonts/', pathToFileURL(
    createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))));
  const files = () => readdirSync(dir);
  return {
    name: 'pdfjs-standard-fonts',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\/studio\/standard_fonts\//, '');
        // Exact filename only: no path separators reach `join`, so this cannot walk out of `dir`.
        if (name === req.url?.split('?')[0] || name.includes('/') || !files().includes(name)) return next();
        res.setHeader('content-type', name.endsWith('.ttf') ? 'font/ttf' : 'application/octet-stream');
        res.end(readFileSync(join(dir, name)));
      });
    },
    generateBundle() {
      for (const name of files()) {
        this.emitFile({ type: 'asset', fileName: `standard_fonts/${name}`, source: readFileSync(join(dir, name)) });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // Dev-only: Vite binds to localhost, so the dev server is unreachable from another device
  // (e.g. a phone on the same tailnet). DEV_HOST overrides the bind address. It's read from the
  // repo-root .env — which is gitignored — so no machine-specific address lands in this tracked
  // file, and the `DEV_` prefix keeps the rest of that file (secrets) out of this config.
  // Unset => Vite's localhost-only default, which is what CI and everyone else keeps getting.
  // `loadEnv` copies a NODE_ENV found in those files into process.env.VITE_USER_NODE_ENV even
  // though the prefix filter is 'DEV_'. The repo-root .env sets NODE_ENV=development, so that
  // leak makes Vite resolve isProduction=false for `vite build`, which emits jsxDEV() calls
  // against the production jsx-runtime — the built SPA then dies on load with
  // "jsxDEV is not a function" and renders a blank page. CI and Docker never see it: they have
  // no repo-root .env. Restore the variable so only the real environment decides.
  const userNodeEnvBefore = process.env.VITE_USER_NODE_ENV;
  const rootEnv = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), 'DEV_');
  if (userNodeEnvBefore === undefined) delete process.env.VITE_USER_NODE_ENV;
  else process.env.VITE_USER_NODE_ENV = userNodeEnvBefore;

  return {
    base: '/studio/',
    plugins: [react(), tailwindcss(), redirectStudioBase(), pdfjsStandardFonts()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    // react-grid-layout / react-draggable / react-resizable reference `process.env.NODE_ENV`
    // at runtime; without this define, `process` is undefined in the dev browser and the
    // drag/resize start handlers throw `process is not defined`, silently disabling them.
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      __APP_VERSION__: JSON.stringify(pkgVersion),
    },
    server: {
      host: rootEnv.DEV_HOST || undefined,
      // Pin the port. Studio and web both used Vite's default 5173 and relied on the
      // "port in use, trying another one" fallback to separate them. That fallback only
      // fires on EADDRINUSE, and once DEV_HOST binds the literal 127.0.0.1 while web
      // binds `localhost` (::1 on Windows), the two sockets no longer collide — both
      // servers keep 5173 and the browser reaches whichever one it resolves to.
      // strictPort so a real conflict fails loudly instead of drifting again.
      port: 5173,
      strictPort: true,
      proxy: { '/api': 'http://localhost:3000' },
    },
    test: { environment: 'jsdom', globals: true, setupFiles: ['./src/setupTests.ts'] },
  };
});
