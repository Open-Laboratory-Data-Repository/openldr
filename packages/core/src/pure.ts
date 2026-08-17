/** Browser-safe subset of @openldr/core.
 *
 * ⛔ The main entry (`./index.ts`) re-exports the logger (pino), crash-log (`node:fs`) and crypto
 * (`node:crypto`), so importing `@openldr/core` from any module that reaches browser code breaks
 * the studio's bundle. Anything added here MUST be free of Node built-ins and Node-only deps. */
export * from './canonical-json';
export * from './semver';
