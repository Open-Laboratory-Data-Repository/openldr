import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './load';

const valid = {
  INTERNAL_DATABASE_URL: 'postgres://u:p@localhost:5432/openldr',
  TARGET_DATABASE_URL: 'postgres://u:p@localhost:5432/openldr_target',
  S3_ENDPOINT: 'http://localhost:9010',
  S3_ACCESS_KEY_ID: 'minio',
  S3_SECRET_ACCESS_KEY: 'minio12345',
  S3_BUCKET: 'openldr',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/master',
};

describe('loadConfig', () => {
  it('parses a valid env and applies defaults', () => {
    const cfg = loadConfig(valid);
    expect(cfg.AUTH_ADAPTER).toBe('keycloak');
    expect(cfg.PORT).toBe(3000);
    expect(cfg.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('throws a ConfigError listing missing required vars', () => {
    expect(() => loadConfig({})).toThrowError(/INTERNAL_DATABASE_URL/);
  });
});

const basePg = {
  INTERNAL_DATABASE_URL: 'postgres://u:p@localhost:5432/openldr',
  TARGET_DATABASE_URL: 'postgres://u:p@localhost:5432/openldr',
  S3_ENDPOINT: 'http://localhost:9010', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 'b', S3_BUCKET: 'openldr',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/openldr',
};

describe('config target-store engine', () => {
  it('defaults TARGET_STORE_ADAPTER to pg', () => {
    expect(loadConfig({ ...basePg } as never).TARGET_STORE_ADAPTER).toBe('pg');
  });
  it('accepts a full mssql config', () => {
    const cfg = loadConfig({
      ...basePg, TARGET_STORE_ADAPTER: 'mssql',
      MSSQL_HOST: '127.0.0.1', MSSQL_DATABASE: 'openldr', MSSQL_USER: 'sa', MSSQL_PASSWORD: 'Openldr_Local_2026!',
    } as never);
    expect(cfg.TARGET_STORE_ADAPTER).toBe('mssql');
    expect(cfg.MSSQL_PORT).toBe(1433);
    expect(cfg.MSSQL_TRUST_SERVER_CERT).toBe(true);
  });
  it('rejects mssql adapter without MSSQL connection fields', () => {
    expect(() => loadConfig({ ...basePg, TARGET_STORE_ADAPTER: 'mssql' } as never)).toThrow(/MSSQL_HOST/);
  });
  it('accepts TARGET_STORE_ADAPTER=mysql with the MYSQL_* vars', () => {
    const cfg = loadConfig({
      ...basePg, TARGET_STORE_ADAPTER: 'mysql',
      MYSQL_HOST: 'db', MYSQL_DATABASE: 'openldr_target', MYSQL_USER: 'u', MYSQL_PASSWORD: 'p',
    } as never);
    expect(cfg.TARGET_STORE_ADAPTER).toBe('mysql');
    expect(cfg.MYSQL_PORT).toBe(3306);
  });
  it('rejects TARGET_STORE_ADAPTER=mysql without required MYSQL_* vars', () => {
    expect(() => loadConfig({ ...basePg, TARGET_STORE_ADAPTER: 'mysql' } as never)).toThrow(/MYSQL_HOST is required when TARGET_STORE_ADAPTER=mysql/);
  });
  it('rejects pg adapter without TARGET_DATABASE_URL', () => {
    const { TARGET_DATABASE_URL: _omit, ...noUrl } = basePg;
    expect(() => loadConfig({ ...noUrl } as never)).toThrow(/TARGET_DATABASE_URL/);
  });
});

describe('config S3_FORCE_PATH_STYLE', () => {
  it('defaults to true', () => {
    expect(loadConfig({ ...basePg } as never).S3_FORCE_PATH_STYLE).toBe(true);
  });
  it('parses the string "false" as false (not coerced to true)', () => {
    expect(loadConfig({ ...basePg, S3_FORCE_PATH_STYLE: 'false' } as never).S3_FORCE_PATH_STYLE).toBe(false);
  });
  it('parses the string "0" as false', () => {
    expect(loadConfig({ ...basePg, S3_FORCE_PATH_STYLE: '0' } as never).S3_FORCE_PATH_STYLE).toBe(false);
  });
});

describe('config MSSQL boolean flags', () => {
  it('parses MSSQL_ENCRYPT="true" as true (default false)', () => {
    expect(loadConfig({ ...basePg } as never).MSSQL_ENCRYPT).toBe(false);
    expect(loadConfig({ ...basePg, MSSQL_ENCRYPT: 'true' } as never).MSSQL_ENCRYPT).toBe(true);
  });
  it('parses MSSQL_TRUST_SERVER_CERT="false" as false (default true)', () => {
    expect(loadConfig({ ...basePg } as never).MSSQL_TRUST_SERVER_CERT).toBe(true);
    expect(loadConfig({ ...basePg, MSSQL_TRUST_SERVER_CERT: 'false' } as never).MSSQL_TRUST_SERVER_CERT).toBe(false);
  });
});

describe('config MySQL boolean flags', () => {
  it('parses MYSQL_SSL_REJECT_UNAUTHORIZED (default false, "true" -> true)', () => {
    expect(loadConfig({ ...basePg } as never).MYSQL_SSL_REJECT_UNAUTHORIZED).toBe(false);
    expect(loadConfig({ ...basePg, MYSQL_SSL_REJECT_UNAUTHORIZED: 'true' } as never).MYSQL_SSL_REJECT_UNAUTHORIZED).toBe(true);
  });
});

// loadConfig() with no argument loads the nearest .env into process.env, once per module.
// Each test gets a fresh module, a temporary working folder holding a .env, and a process.env
// with every required key but LOG_LEVEL, which only the .env sets.
describe('OPENLDR_SKIP_ENV_FILE', () => {
  let savedEnv: NodeJS.ProcessEnv;
  let savedCwd: string;
  let dir: string;

  beforeEach(() => {
    savedEnv = { ...process.env };
    savedCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'openldr-skip-env-'));
    writeFileSync(join(dir, '.env'), 'LOG_LEVEL=trace\n');
    process.chdir(dir);
    delete process.env.LOG_LEVEL;
    delete process.env.OPENLDR_SKIP_ENV_FILE;
    Object.assign(process.env, valid);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(savedCwd);
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    rmSync(dir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('reads the .env when the switch is unset', async () => {
    const { loadConfig: fresh } = await import('./load');
    expect(fresh().LOG_LEVEL).toBe('trace');
  });

  it.each(['true', '1'])('does not read the .env when the switch is %s', async (value) => {
    process.env.OPENLDR_SKIP_ENV_FILE = value;
    const { loadConfig: fresh } = await import('./load');
    expect(fresh().LOG_LEVEL).toBe('info');
    expect(process.env.LOG_LEVEL).toBeUndefined();
  });

  it('reads the .env when the switch has any other value', async () => {
    process.env.OPENLDR_SKIP_ENV_FILE = 'false';
    const { loadConfig: fresh } = await import('./load');
    expect(fresh().LOG_LEVEL).toBe('trace');
  });
});
