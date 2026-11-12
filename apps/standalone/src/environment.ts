// The environment a standalone server runs with. The launcher sets these keys before it loads the
// server, and passes a copy to loadConfig. The CLI gets the same keys.
//
// Only Linux is tested. The path checks below are unproven on Windows and macOS.

import { isAbsolute } from 'node:path';
import { parseSecretKey } from '@openldr/core';
import type { StandalonePaths, StandaloneState } from './state.js';

export interface EnvironmentInput {
  paths: StandalonePaths;
  state: StandaloneState;
  internalUrl: string;
  targetUrl: string;
  port: number;
  host: string;
  studioDist: string;
  appVersion: string;
}

/**
 * Builds every key a standalone server needs, and nothing more. It reads nothing from
 * `process.env`, so nothing from the shell or a `.env` file leaks in.
 *
 * Every path is inside the data folder, apart from the studio build, which ships with the app.
 * `TERMINOLOGY_WORK_DIR` is the data folder itself: an ingest makes its own scratch folder there
 * and removes it. Unset, it would fall back to the system temp folder.
 *
 * Throws on unusable input. The message names the field and never its value, since some values
 * are secrets.
 */
export function buildEnvironment(input: EnvironmentInput): Record<string, string> {
  check(input);
  const { paths, state } = input;
  return {
    NODE_ENV: 'production',
    TZ: 'UTC',
    // loadConfig() with no argument, as the CLI commands call it, must not read a `.env` file.
    OPENLDR_SKIP_ENV_FILE: 'true',
    PORT: String(input.port),
    LISTEN_HOST: input.host,
    ROOT_REDIRECT_TO_STUDIO: 'true',
    LOG_LEVEL: 'info',
    LOG_FILE: paths.serverLog,
    AUTH_ADAPTER: 'local',
    AUTH_DEV_BYPASS: 'false',
    BLOB_ADAPTER: 'fs',
    BLOB_DIR: paths.blobs,
    EVENTING_ADAPTER: 'pg',
    TARGET_STORE_ADAPTER: 'pg',
    INTERNAL_DATABASE_URL: input.internalUrl,
    TARGET_DATABASE_URL: input.targetUrl,
    MIGRATE_ON_START: 'true',
    SEED_ON_START: 'false',
    SECRETS_ENCRYPTION_KEY: state.secretsKey,
    PLUGIN_CRASH_LOG_DIR: paths.crash,
    TERMINOLOGY_WORK_DIR: paths.root,
    WEB_DIST_DIR: input.studioDist,
    APP_VERSION: input.appVersion,
  };
}

function check(input: EnvironmentInput): void {
  const refuse = (field: string, why: string): never => {
    throw new Error(`Cannot build the server environment: ${field} ${why}.`);
  };
  const { port } = input;
  if (!Number.isInteger(port) || port < 1 || port > 65535) refuse('port', 'must be a whole number from 1 to 65535');
  for (const field of ['host', 'internalUrl', 'targetUrl', 'appVersion'] as const) {
    if (input[field] === '') refuse(field, 'is empty');
  }
  try {
    parseSecretKey(input.state.secretsKey);
  } catch {
    refuse('state.secretsKey', 'is not a base64 key of 32 bytes');
  }
  const absolute: Array<[string, string]> = [
    ['paths.root', input.paths.root],
    ['paths.blobs', input.paths.blobs],
    ['paths.crash', input.paths.crash],
    ['paths.serverLog', input.paths.serverLog],
    ['studioDist', input.studioDist],
  ];
  for (const [field, value] of absolute) {
    if (!isAbsolute(value)) refuse(field, 'must be an absolute path');
  }
}
