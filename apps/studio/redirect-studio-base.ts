import type { Plugin } from 'vite';

// Dev-only: Vite serves the SPA under base `/studio/` and, for a bare `/studio` (no trailing
// slash), shows a "did you mean /studio/" notice instead of redirecting. Send a 302 so the bare
// path just works in dev (nginx handles this in production).
//
// It also answers `HEAD /` with a plain 200. The Claude desktop app decides a preview server is up
// by sending `HEAD http://localhost:<port>` with redirects turned off, and it counts Vite's
// `/` -> `/studio/` 302 as "not up". After 180 s it gives up, marks the server running anyway and
// reloads the preview tab at `/`, which throws away whatever page was open, unsaved form-builder
// edits included. `GET /` still gets Vite's redirect, so a browser opening the root lands on
// `/studio/` as before.
export function redirectStudioBase(): Plugin {
  return {
    name: 'redirect-studio-base',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [path, query] = (req.url ?? '').split('?');
        if (req.method === 'HEAD' && path === '/') {
          res.writeHead(200);
          res.end();
          return;
        }
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
