import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Kysely } from 'kysely';
import type { Logger } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';
import type { InternalSchema } from '@openldr/db';
import type { AuditStore } from '@openldr/audit';
import { safeRecord } from '@openldr/audit';
import { createPluginStore, createPluginRuntime, createExtismRunner, type PluginRuntime } from '@openldr/plugins';
import { createTrustStore } from '@openldr/marketplace';

/**
 * The CE version an artifact's `compatibility.ceVersion` range is checked against.
 * Prefers APP_VERSION, which build-and-push.sh sets in the image from the root package.json.
 * Else reads the nearest package.json by walking up from this module, the same order as the
 * server's readAppVersion: in dev that is the root package.json, which the release bumps; in a
 * bundled server or CLI it is the deployed app's package.json, which the release bumps too.
 * Never @openldr/bootstrap's own package.json, which the release does not bump.
 */
export function readCeVersion(env: Record<string, string | undefined> = process.env): string {
  if (env.APP_VERSION) return env.APP_VERSION;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../../package.json'), // dev: packages/bootstrap/src -> repo root
    resolve(here, '../../package.json'),
    resolve(here, '../package.json'),       // bundled: <app>/dist -> <app>
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // try next candidate
    }
  }
  return '0.0.0';
}

export const CE_VERSION = readCeVersion();

/** Single source of truth for wiring the plugin/artifact registry — used by both the ingest worker and the server AppContext. */
export function createPluginRegistry(deps: {
  blob: BlobStoragePort;
  internalDb: Kysely<InternalSchema>;
  logger: Logger;
  audit: AuditStore;
  devAllowUnsigned: boolean;
}): PluginRuntime {
  return createPluginRuntime({
    blob: deps.blob,
    store: createPluginStore(deps.internalDb),
    runner: createExtismRunner(),
    logger: deps.logger,
    trustStore: createTrustStore(deps.internalDb),
    ceVersion: CE_VERSION,
    verifyConfig: { devAllowUnsigned: deps.devAllowUnsigned },
    recordInstall: (e) => safeRecord(deps.audit, deps.logger, e),
  });
}
