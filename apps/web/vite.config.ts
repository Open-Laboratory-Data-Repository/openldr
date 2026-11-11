/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Single source of truth for the docs version: the app's package version, injected at
// build/test time so the docs version tracks releases (see src/docs/content.ts).
const pkgVersion = createRequire(import.meta.url)('./package.json').version as string;

export default defineConfig(({ mode }) => {
  // Dev-only bind address, same as studio: DEV_HOST from the gitignored repo-root .env.
  // Unset means Vite's localhost-only default. Restore VITE_USER_NODE_ENV afterwards,
  // because loadEnv leaks the .env's NODE_ENV into it and breaks `vite build`.
  // See apps/studio/vite.config.ts for the full story.
  const userNodeEnvBefore = process.env.VITE_USER_NODE_ENV;
  const rootEnv = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), 'DEV_');
  if (userNodeEnvBefore === undefined) delete process.env.VITE_USER_NODE_ENV;
  else process.env.VITE_USER_NODE_ENV = userNodeEnvBefore;

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
    // Pin the port. Studio owns 5173; the landing site takes 5174, which is where Vite's
    // fallback used to put it. Both apps defaulting to 5173 only worked while the two
    // servers collided on the same socket. See apps/studio/vite.config.ts.
    server: { host: rootEnv.DEV_HOST || undefined, port: 5174, strictPort: true },
    test: { environment: 'jsdom', globals: true, setupFiles: ['./src/setupTests.ts'] },
  };
});
